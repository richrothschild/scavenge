import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { useGameClient } from "./src/hooks/useGameClient";

export default function App() {
  const {
    apiBaseUrl,
    isJoined,
    loading,
    statusMessage,
    errorMessage,
    role,
    teamName,
    teamState,
    leaderboard,
    eventFeed,
    eventFeedTotal,
    eventFeedLimit,
    eventFeedOffset,
    eventFeedCurrentPage,
    eventFeedTotalPages,
    canPrevEventFeedPage,
    canNextEventFeedPage,
    submissionHistory,
    submissionHistoryTotal,
    submissionHistoryLimit,
    submissionHistoryOffset,
    submissionHistoryCurrentPage,
    submissionHistoryTotalPages,
    canPrevSubmissionHistoryPage,
    canNextSubmissionHistoryPage,
    joinCode,
    displayName,
    captainPin,
    submissionText,
    scanSessionToken,
    scanSessionExpiresAt,
    checkpointPublicId,
    setJoinCode,
    setDisplayName,
    setCaptainPin,
    setSubmissionText,
    setScanSessionToken,
    setCheckpointPublicId,
    setEventFeedLimit,
    setEventFeedOffset,
    setSubmissionHistoryLimit,
    setSubmissionHistoryOffset,
    join,
    refresh,
    submit,
    pass,
    createScanSession,
    validateScan,
    reportScreenshotAttempt,
    prevEventFeedPage,
    nextEventFeedPage,
    prevSubmissionHistoryPage,
    nextSubmissionHistoryPage
  } = useGameClient();

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Scavenge Mobile</Text>
        <Text style={styles.subtitle}>API: {apiBaseUrl}</Text>

        {!isJoined ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Join Team</Text>
            <TextInput style={styles.input} value={joinCode} onChangeText={setJoinCode} placeholder="Join code" autoCapitalize="characters" />
            <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="Display name" />
            <TextInput
              style={styles.input}
              value={captainPin}
              onChangeText={setCaptainPin}
              placeholder="Captain PIN (optional)"
              secureTextEntry
            />
            <Pressable style={[styles.button, loading && styles.buttonDisabled]} onPress={join} disabled={loading}>
              <Text style={styles.buttonText}>{loading ? "Joining..." : "Join"}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Team</Text>
              <Text>{teamName}</Text>
              <Text>Role: {role}</Text>
              <Text>Status: {statusMessage}</Text>
              {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
              <Pressable style={[styles.button, loading && styles.buttonDisabled]} onPress={reportScreenshotAttempt} disabled={loading}>
                <Text style={styles.buttonText}>Report Screenshot Attempt</Text>
              </Pressable>
              <Pressable style={[styles.button, loading && styles.buttonDisabled]} onPress={refresh} disabled={loading}>
                <Text style={styles.buttonText}>Refresh</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Current Clue</Text>
              <Text>Index: {teamState?.currentClueIndex ?? "-"}</Text>
              <Text>Title: {teamState?.currentClue?.title ?? "-"}</Text>
              <Text>Required: {teamState?.currentClue?.required_flag ? "Yes" : "No"}</Text>
              <Text>Transport: {teamState?.currentClue?.transport_mode ?? "-"}</Text>
              <Text>Progress: {teamState?.completedCount ?? 0}/12 complete · {teamState?.skippedCount ?? 0} skips</Text>
              <Text>Eligibility: {teamState?.eligibilityStatus ?? "-"}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Captain Actions</Text>
              {role !== "CAPTAIN" ? (
                <Text>Read-only for members.</Text>
              ) : (
                <>
                  <TextInput
                    style={styles.input}
                    value={submissionText}
                    onChangeText={setSubmissionText}
                    placeholder="Submission text"
                    multiline
                  />
                  <View style={styles.row}>
                    <Pressable style={[styles.button, styles.rowButton, loading && styles.buttonDisabled]} onPress={submit} disabled={loading}>
                      <Text style={styles.buttonText}>Submit</Text>
                    </Pressable>
                    <Pressable style={[styles.button, styles.rowButton, loading && styles.buttonDisabled]} onPress={pass} disabled={loading}>
                      <Text style={styles.buttonText}>Pass</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>QR Check-in</Text>
              <Text>Required for this clue: {teamState?.currentClue?.requires_scan ? "Yes" : "No"}</Text>
              <TextInput
                style={styles.input}
                value={scanSessionToken}
                onChangeText={setScanSessionToken}
                placeholder="Scan session token"
              />
              <TextInput
                style={styles.input}
                value={checkpointPublicId}
                onChangeText={setCheckpointPublicId}
                placeholder="Checkpoint public ID"
              />
              {scanSessionExpiresAt ? <Text>Session expires: {scanSessionExpiresAt}</Text> : null}
              <View style={styles.row}>
                <Pressable style={[styles.button, styles.rowButton, loading && styles.buttonDisabled]} onPress={createScanSession} disabled={loading}>
                  <Text style={styles.buttonText}>Get Session</Text>
                </Pressable>
                <Pressable style={[styles.button, styles.rowButton, loading && styles.buttonDisabled]} onPress={validateScan} disabled={loading}>
                  <Text style={styles.buttonText}>Validate QR</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Leaderboard</Text>
              {leaderboard.map((row) => (
                <Text key={row.teamId}>
                  {row.teamName}: {row.scoreTotal} pts · clue {row.currentClueIndex} · {row.eligibilityStatus}
                </Text>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Event Feed</Text>
              <Text>Showing {eventFeed.length} of {eventFeedTotal}</Text>
              <Text>{eventFeedTotalPages === 0 ? "No pages yet" : `Page ${eventFeedCurrentPage} of ${eventFeedTotalPages}`}</Text>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.rowButton]}
                  value={eventFeedLimit}
                  onChangeText={setEventFeedLimit}
                  placeholder="Limit"
                  keyboardType="numeric"
                />
                <TextInput
                  style={[styles.input, styles.rowButton]}
                  value={eventFeedOffset}
                  onChangeText={setEventFeedOffset}
                  placeholder="Offset"
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.row}>
                <Pressable
                  style={[styles.button, styles.rowButton, (loading || !canPrevEventFeedPage) && styles.buttonDisabled]}
                  onPress={prevEventFeedPage}
                  disabled={loading || !canPrevEventFeedPage}
                >
                  <Text style={styles.buttonText}>Prev</Text>
                </Pressable>
                <Pressable
                  style={[styles.button, styles.rowButton, (loading || !canNextEventFeedPage) && styles.buttonDisabled]}
                  onPress={nextEventFeedPage}
                  disabled={loading || !canNextEventFeedPage}
                >
                  <Text style={styles.buttonText}>Next</Text>
                </Pressable>
              </View>
              {eventFeed.length === 0 ? <Text>No events yet.</Text> : null}
              {eventFeed.map((event) => (
                <View key={event.id} style={styles.feedItem}>
                  <Text style={styles.feedTitle}>{event.title}</Text>
                  <Text>{event.type} · {new Date(event.timestamp).toLocaleTimeString()}</Text>
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Submission History</Text>
              <Text>Showing {submissionHistory.length} of {submissionHistoryTotal}</Text>
              <Text>{submissionHistoryTotalPages === 0 ? "No pages yet" : `Page ${submissionHistoryCurrentPage} of ${submissionHistoryTotalPages}`}</Text>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.rowButton]}
                  value={submissionHistoryLimit}
                  onChangeText={setSubmissionHistoryLimit}
                  placeholder="Limit"
                  keyboardType="numeric"
                />
                <TextInput
                  style={[styles.input, styles.rowButton]}
                  value={submissionHistoryOffset}
                  onChangeText={setSubmissionHistoryOffset}
                  placeholder="Offset"
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.row}>
                <Pressable
                  style={[styles.button, styles.rowButton, (loading || !canPrevSubmissionHistoryPage) && styles.buttonDisabled]}
                  onPress={prevSubmissionHistoryPage}
                  disabled={loading || !canPrevSubmissionHistoryPage}
                >
                  <Text style={styles.buttonText}>Prev</Text>
                </Pressable>
                <Pressable
                  style={[styles.button, styles.rowButton, (loading || !canNextSubmissionHistoryPage) && styles.buttonDisabled]}
                  onPress={nextSubmissionHistoryPage}
                  disabled={loading || !canNextSubmissionHistoryPage}
                >
                  <Text style={styles.buttonText}>Next</Text>
                </Pressable>
              </View>
              {submissionHistory.length === 0 ? <Text>No submissions yet.</Text> : null}
              {submissionHistory.map((submission) => (
                <View key={submission.id} style={styles.feedItem}>
                  <Text style={styles.feedTitle}>
                    Clue {submission.clueIndex} · {submission.verdict} · +{submission.pointsAwarded} pts
                  </Text>
                  <Text>{new Date(submission.createdAt).toLocaleTimeString()} · AI {submission.aiScore}</Text>
                  {submission.reasons.map((reason, index) => (
                    <Text key={`${submission.id}-${index}`}>• {reason}</Text>
                  ))}
                </View>
              ))}
            </View>
          </>
        )}

        {loading ? <ActivityIndicator size="small" /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#fff"
  },
  container: {
    padding: 16,
    gap: 12
  },
  title: {
    fontSize: 24,
    fontWeight: "700"
  },
  subtitle: {
    fontSize: 12,
    color: "#666"
  },
  card: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    gap: 8
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600"
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#fff"
  },
  button: {
    backgroundColor: "#2563eb",
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center"
  },
  buttonDisabled: {
    opacity: 0.5
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600"
  },
  row: {
    flexDirection: "row",
    gap: 8
  },
  rowButton: {
    flex: 1
  },
  error: {
    color: "#b91c1c"
  },
  feedItem: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 6,
    padding: 8,
    gap: 4
  },
  feedTitle: {
    fontWeight: "600"
  }
});
