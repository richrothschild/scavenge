/**
 * Pop Culture Quiz Seed Script
 *
 * Usage (from the /backend directory):
 *   npm run seed-quiz
 *
 * What it does:
 *   1. Lists all images in your Cloudinary "Assets" folder
 *   2. Sends each image URL to GPT-4o Vision to identify it and generate 4 MCQ options
 *   3. Writes/updates ../admin/src/quiz-data.json
 *   4. Skips images already present in quiz-data.json (safe to re-run)
 *
 * Prerequisites:
 *   - Ensure your .env has: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
 *     CLOUDINARY_API_SECRET, OPENAI_API_KEY
 *
 * After running:
 *   - Open admin/src/quiz-data.json and review the AI identifications
 *   - Fix any wrong "answer" or "question" fields manually
 *   - Commit quiz-data.json and deploy
 */

import { v2 as cloudinary } from "cloudinary";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const CLOUDINARY_FOLDER = "Assets";
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
    process.exit(1);
  }
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

type CloudinaryResource = {
  public_id: string;
  secure_url: string;
  format: string;
};

async function listAllAssets(): Promise<CloudinaryResource[]> {
  const results: CloudinaryResource[] = [];
  let nextCursor: string | undefined = undefined;

  do {
    const response = await cloudinary.api.resources({
      type: "upload",
      prefix: CLOUDINARY_FOLDER + "/",
      max_results: 100,
      ...(nextCursor ? { next_cursor: nextCursor } : {}),
    }) as { resources: CloudinaryResource[]; next_cursor?: string };

    results.push(...response.resources);
    nextCursor = response.next_cursor;
  } while (nextCursor);

  return results;
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
- Distractors should be from the same category (e.g. if the answer is a singer, distractors are other singers from the same era)
- Distractors should be plausible but clearly wrong to someone familiar with pop culture
- If you genuinely cannot identify the image, set answer to "Unknown" and use generic distractors from the same apparent category`;

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

  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });

  // Load existing quiz data to support re-runs without reprocessing
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

  console.log(`\n🔍 Fetching assets from Cloudinary folder: ${CLOUDINARY_FOLDER}...`);
  const assets = await listAllAssets();
  console.log(`🖼️  Found ${assets.length} image(s) in Cloudinary`);

  const newAssets = assets.filter((a) => !existingIds.has(a.public_id));
  const skipped = assets.length - newAssets.length;

  if (skipped > 0) {
    console.log(`⏭️  Skipping ${skipped} already-processed image(s)`);
  }
  if (newAssets.length === 0) {
    console.log("\n✅ All images already processed. quiz-data.json is up to date.\n");
    process.exit(0);
  }

  console.log(`\n🚀 Processing ${newAssets.length} new image(s)...\n`);

  const results: QuizEntry[] = [...existing];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < newAssets.length; i++) {
    const asset = newAssets[i]!;
    const num = `[${i + 1}/${newAssets.length}]`;
    const label = asset.public_id.split("/").pop() ?? asset.public_id;

    process.stdout.write(`${num} ${label} → identifying...`);

    let identified: { answer: string; question: string; distractors: string[] };
    try {
      identified = await identifyImage(asset.secure_url);
      process.stdout.write(` "${identified.answer}"\n`);
    } catch (err) {
      console.error(` ❌ Failed: ${err instanceof Error ? err.message : err}`);
      identified = {
        answer: "Unknown — please fill in manually",
        question: "Who or what is this?",
        distractors: ["Option B", "Option C", "Option D"],
      };
      failCount++;
    }

    const options = shuffle([identified.answer, ...identified.distractors]);

    results.push({
      id: asset.public_id,
      imageUrl: asset.secure_url,
      question: identified.question,
      answer: identified.answer,
      options,
    });

    // Write after each image so progress is saved if interrupted
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
    successCount++;
  }

  console.log(`\n✅ Done! ${successCount} entries written, ${failCount} need manual review.`);
  console.log(`📄 Output: ${OUTPUT_PATH}`);
  console.log(`\n📝 Next steps:`);
  console.log(`   1. Open admin/src/quiz-data.json and review identifications`);
  console.log(`   2. Fix any entries marked "Unknown — please fill in manually"`);
  console.log(`   3. git add admin/src/quiz-data.json && git commit -m "Add quiz data" && git push\n`);
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err);
  process.exit(1);
});
