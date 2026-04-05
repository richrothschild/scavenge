/**
 * Pop Culture Quiz Seed Script
 *
 * Usage (from the /backend directory):
 *   npm run seed-quiz -- /path/to/your/images/folder
 *
 * What it does:
 *   1. Reads every image file in the given folder
 *   2. Uploads each to Cloudinary (skips duplicates already in quiz-data.json)
 *   3. Sends each image to GPT-4o Vision to identify it and generate 4 MCQ options
 *   4. Writes/updates ../admin/src/quiz-data.json
 *
 * Prerequisites:
 *   - Run `npm install` in /backend first (installs cloudinary SDK)
 *   - Ensure your .env has: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
 *     CLOUDINARY_API_SECRET, OPENAI_API_KEY
 *
 * After running:
 *   - Open admin/src/quiz-data.json and review the AI identifications
 *   - Correct any wrong "answer" or "question" fields manually
 *   - Commit quiz-data.json and deploy
 */

import { v2 as cloudinary } from "cloudinary";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic"]);
const OUTPUT_PATH = path.resolve(__dirname, "../../../../admin/src/quiz-data.json");

type QuizEntry = {
  id: string;
  imageUrl: string;
  question: string;
  answer: string;
  options: string[];
};

function validateEnv() {
  const missing: string[] = [];
  if (!CLOUDINARY_CLOUD_NAME) missing.push("CLOUDINARY_CLOUD_NAME");
  if (!CLOUDINARY_API_KEY) missing.push("CLOUDINARY_API_KEY");
  if (!CLOUDINARY_API_SECRET) missing.push("CLOUDINARY_API_SECRET");
  if (!OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (missing.length > 0) {
    console.error(`\n❌ Missing required environment variables:\n  ${missing.join("\n  ")}`);
    console.error("\nMake sure your backend/.env file contains all four values.\n");
    process.exit(1);
  }
}

function makeId(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 60) + "_" + crypto.createHash("md5").update(filename).digest("hex").slice(0, 6);
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

async function uploadToCloudinary(imagePath: string): Promise<string> {
  const result = await cloudinary.uploader.upload(imagePath, {
    folder: "pop-culture-quiz",
    use_filename: false,
    unique_filename: true,
  });
  return result.secure_url;
}

async function identifyImage(imageUrl: string): Promise<{
  answer: string;
  question: string;
  distractors: string[];
}> {
  const systemPrompt = `You are identifying images for a pop culture quiz. Your job is to identify who or what is shown and generate multiple choice options.

Respond ONLY with valid JSON in this exact format (no markdown, no extra text):
{
  "answer": "the correct answer (full name or title)",
  "question": "a short quiz question appropriate for the image type (e.g. 'Who is this?', 'What movie is this?', 'What album is this?', 'What TV show is this from?')",
  "distractors": ["plausible wrong answer 1", "plausible wrong answer 2", "plausible wrong answer 3"]
}

Rules:
- Be specific: use the full name of the person, movie, album, TV show, athlete, etc.
- Distractors should be from the same category (e.g. if the answer is a singer, distractors are other singers)
- Distractors should be plausible but clearly wrong to someone familiar with pop culture
- If you genuinely cannot identify the image, set answer to "Unknown" and use generic distractors`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Identify this image and generate quiz options." },
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 300,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "(no body)");
    throw new Error(`OpenAI API error ${response.status}: ${err}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  const raw = data.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as Partial<{ answer: string; question: string; distractors: string[] }>;

  return {
    answer: typeof parsed.answer === "string" ? parsed.answer : "Unknown",
    question: typeof parsed.question === "string" ? parsed.question : "Who or what is this?",
    distractors: Array.isArray(parsed.distractors)
      ? parsed.distractors.filter((d): d is string => typeof d === "string").slice(0, 3)
      : ["Option B", "Option C", "Option D"],
  };
}

async function main() {
  validateEnv();

  const imagesDir = process.argv[2];
  if (!imagesDir) {
    console.error("\n❌ Usage: npm run seed-quiz -- /path/to/images/folder\n");
    process.exit(1);
  }

  const resolvedDir = path.resolve(imagesDir);
  if (!fs.existsSync(resolvedDir)) {
    console.error(`\n❌ Directory not found: ${resolvedDir}\n`);
    process.exit(1);
  }

  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });

  // Load existing quiz data
  let existing: QuizEntry[] = [];
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8")) as QuizEntry[];
      console.log(`\n📂 Loaded ${existing.length} existing entries from quiz-data.json`);
    } catch {
      console.warn("⚠️  Could not parse existing quiz-data.json — starting fresh");
    }
  }

  const existingIds = new Set(existing.map((e) => e.id));

  // Find image files
  const allFiles = fs.readdirSync(resolvedDir);
  const imageFiles = allFiles.filter((f) =>
    SUPPORTED_EXTENSIONS.has(path.extname(f).toLowerCase())
  );

  console.log(`\n🖼️  Found ${imageFiles.length} image(s) in ${resolvedDir}`);

  const newFiles = imageFiles.filter((f) => !existingIds.has(makeId(f)));
  const skipped = imageFiles.length - newFiles.length;

  if (skipped > 0) {
    console.log(`⏭️  Skipping ${skipped} already-processed image(s)`);
  }
  if (newFiles.length === 0) {
    console.log("\n✅ All images already processed. quiz-data.json is up to date.\n");
    process.exit(0);
  }

  console.log(`\n🚀 Processing ${newFiles.length} new image(s)...\n`);

  const results: QuizEntry[] = [...existing];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < newFiles.length; i++) {
    const filename = newFiles[i]!;
    const imagePath = path.join(resolvedDir, filename);
    const id = makeId(filename);
    const num = `[${i + 1}/${newFiles.length}]`;

    process.stdout.write(`${num} ${filename} → uploading...`);

    let imageUrl: string;
    try {
      imageUrl = await uploadToCloudinary(imagePath);
      process.stdout.write(" uploaded → identifying...");
    } catch (err) {
      console.error(` ❌ Upload failed: ${err instanceof Error ? err.message : err}`);
      failCount++;
      continue;
    }

    let identified: { answer: string; question: string; distractors: string[] };
    try {
      identified = await identifyImage(imageUrl);
      process.stdout.write(` identified as "${identified.answer}"\n`);
    } catch (err) {
      console.error(` ❌ Identification failed: ${err instanceof Error ? err.message : err}`);
      // Still keep the entry with Unknown so user can fill in manually
      identified = {
        answer: "Unknown — please fill in manually",
        question: "Who or what is this?",
        distractors: ["Option B", "Option C", "Option D"],
      };
    }

    const options = shuffle([identified.answer, ...identified.distractors]);

    results.push({
      id,
      imageUrl,
      question: identified.question,
      answer: identified.answer,
      options,
    });

    // Write after each image so progress is saved if the script is interrupted
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
    successCount++;
  }

  console.log(`\n✅ Done! ${successCount} new entries added, ${failCount} failed.`);
  console.log(`📄 Output written to: ${OUTPUT_PATH}`);
  console.log(`\n📝 Next steps:`);
  console.log(`   1. Open admin/src/quiz-data.json and review the AI identifications`);
  console.log(`   2. Fix any wrong "answer" or "question" fields`);
  console.log(`   3. Commit quiz-data.json and deploy\n`);
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err);
  process.exit(1);
});
