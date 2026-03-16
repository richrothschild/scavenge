/**
 * Dictator Admin Console — scavenge-mobile
 *
 * PIN gate (1017) → backend auth (POST /auth/admin/login with PIN as password)
 * → full admin panel.
 *
 * NOTE: The backend ADMIN_PASSWORD Railway variable must be set to "1017"
 * for seamless mobile login, OR you can change the PIN below to match
 * whatever ADMIN_PASSWORD is set to in Railway.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

// ─── Config ──────────────────────────────────────────────────────────────────
const API_BASE = 'https://www.boyzweekend.org/api';
const ADMIN_PIN = '1017';

const TEAMS = [
  { id: 'spades',   name: 'SPADES',   emoji: '♠️' },
  { id: 'hearts',   name: 'HEARTS',   emoji: '♥️' },
  { id: 'diamonds', name: 'DIAMONDS', emoji: '♦️' },
  { id: 'clubs',    name: 'CLUBS',    emoji: '♣️' },
];

type GameStatus = 'PENDING' | 'RUNNING' | 'PAUSED' | 'ENDED';
type AdminTab   = 'game' | 'teams' | 'hints' | 'review' | 'log';

// ─── API helpers ──────────────────────────────────────────────────────────────
async function api(
  path: string,
  adminToken: string,
  opts: RequestInit = {},
): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken,
      ...(opts.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? `HTTP ${res.status}`);
  return json;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function AdminScreen() {
  const router = useRouter();

  // ── Auth state ──────────────────────────────────────────────────────────────
  const [screen, setScreen] = useState<'pin' | 'connecting' | 'panel'>('pin');
  const [pin, setPin]       = useState('');
  const [token, setToken]   = useState('');
  const [authError, setAuthError] = useState('');

  // ── Panel state ─────────────────────────────────────────────────────────────
  const [tab, setTab]               = useState<AdminTab>('game');
  const [busy, setBusy]             = useState(false);
  const [toast, setToast]           = useState<string | null>(null);

  // Game tab
  const [gameStatus, setGameStatus]   = useState<GameStatus>('PENDING');
  const [gameName, setGameName]       = useState('');

  // Teams tab
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [ptTeam, setPtTeam]           = useState(TEAMS[0].id);
  const [ptAmount, setPtAmount]       = useState('');
  const [ptReason, setPtReason]       = useState('');

  // Clue advance / reopen (inside teams tab)
  const [advTeam, setAdvTeam]         = useState(TEAMS[0].id);
  const [advClueIdx, setAdvClueIdx]   = useState('');

  // Hints tab
  const [hintTeam, setHintTeam]       = useState(TEAMS[0].id);
  const [hintClueIdx, setHintClueIdx] = useState('');
  const [hintText, setHintText]       = useState('');

  // Broadcast (game tab)
  const [broadcastMsg, setBroadcastMsg] = useState('');

  // Review tab
  const [reviewQueue, setReviewQueue] = useState<any[]>([]);

  // Log tab
  const [auditLogs, setAuditLogs]     = useState<any[]>([]);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const call = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      try {
        await fn();
      } catch (e: any) {
        showToast(`❌ ${e.message}`);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // ── Auth ────────────────────────────────────────────────────────────────────
  const handlePinKey = (key: string) => {
    setAuthError('');
    if (key === '⌫') { setPin((p) => p.slice(0, -1)); return; }
    const next = pin + key;
    if (next.length > 4) return;
    setPin(next);
    if (next.length === 4) void attemptLogin(next);
  };

  const attemptLogin = async (enteredPin: string) => {
    if (enteredPin !== ADMIN_PIN) {
      setPin('');
      setAuthError('Wrong PIN');
      return;
    }
    setScreen('connecting');
    try {
      const res = await fetch(`${API_BASE}/auth/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: enteredPin }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Auth failed');
      setToken(json.token);
      setScreen('panel');
      void loadGameStatus(json.token);
      void loadLeaderboard(json.token);
    } catch (e: any) {
      setScreen('pin');
      setPin('');
      setAuthError(
        e.message.includes('401') || e.message.includes('Invalid')
          ? 'Backend password mismatch — set ADMIN_PASSWORD=1017 in Railway'
          : e.message,
      );
    }
  };

  // ── Data loaders ────────────────────────────────────────────────────────────
  const loadGameStatus = useCallback(async (tok = token) => {
    const data = await api('/game/status', tok);
    setGameStatus(data.status);
    setGameName(data.name ?? '');
  }, [token]);

  const loadLeaderboard = useCallback(async (tok = token) => {
    const data = await api('/leaderboard', tok);
    setLeaderboard(data.teams ?? []);
  }, [token]);

  const loadReviewQueue = useCallback(async () => {
    const data = await api('/admin/review-queue', token);
    setReviewQueue(data.items ?? data ?? []);
  }, [token]);

  const loadAuditLogs = useCallback(async () => {
    const data = await api('/admin/audit-logs', token);
    setAuditLogs(data.items ?? data ?? []);
  }, [token]);

  // Refresh on tab change
  useEffect(() => {
    if (screen !== 'panel') return;
    if (tab === 'game')   { void loadGameStatus(); void loadLeaderboard(); }
    if (tab === 'teams')  void loadLeaderboard();
    if (tab === 'review') void loadReviewQueue();
    if (tab === 'log')    void loadAuditLogs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, screen]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const setStatus = (s: GameStatus) =>
    call(async () => {
      await api('/game/status', token, { method: 'POST', body: JSON.stringify({ status: s }) });
      setGameStatus(s);
      showToast(`Game set to ${s}`);
    });

  const awardPoints = (mode: 'award' | 'deduct') =>
    call(async () => {
      const amt = Number(ptAmount);
      if (!amt || amt <= 0) throw new Error('Enter a positive amount');
      if (!ptReason.trim())  throw new Error('Enter a reason');
      const endpoint = mode === 'award' ? 'award' : 'deduct';
      const data = await api(`/admin/team/${ptTeam}/${endpoint}`, token, {
        method: 'POST',
        body: JSON.stringify({ amount: amt, reason: ptReason }),
      });
      showToast(`${mode === 'award' ? '+' : '-'}${amt} pts → ${ptTeam.toUpperCase()} (${data.scoreTotal} total)`);
      setPtAmount('');
      setPtReason('');
      void loadLeaderboard();
    });

  const reopenClue = () =>
    call(async () => {
      const idx = Number(advClueIdx);
      if (isNaN(idx) || idx < 0) throw new Error('Enter a valid clue index (0-based)');
      await api(`/admin/team/${advTeam}/reopen-clue`, token, {
        method: 'POST',
        body: JSON.stringify({ clueIndex: idx, reason: 'Admin reset via mobile' }),
      });
      showToast(`Clue ${idx + 1} reopened for ${advTeam.toUpperCase()}`);
      void loadLeaderboard();
    });

  const sendHint = () =>
    call(async () => {
      const idx = Number(hintClueIdx);
      if (!hintText.trim())          throw new Error('Enter hint text');
      if (isNaN(idx) || idx < 0)     throw new Error('Enter a valid clue index');
      await api(`/admin/team/${hintTeam}/hint`, token, {
        method: 'POST',
        body: JSON.stringify({ clueIndex: idx, hintText }),
      });
      showToast(`Hint sent to ${hintTeam.toUpperCase()}`);
      setHintText('');
    });

  const sendBroadcast = () =>
    call(async () => {
      if (!broadcastMsg.trim()) throw new Error('Enter a message');
      await api('/admin/broadcast', token, {
        method: 'POST',
        body: JSON.stringify({ message: broadcastMsg }),
      });
      showToast('Broadcast sent to all teams');
      setBroadcastMsg('');
    });

  const resetSeed = (variant: 'test' | 'production') => {
    Alert.alert(
      `Reset to ${variant.toUpperCase()} clues?`,
      'This wipes all team progress and resets the game to the beginning. The server will restart. OK only while game is PENDING.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset + Restart',
          style: 'destructive',
          onPress: () =>
            call(async () => {
              await api('/admin/reset-seed', token, {
                method: 'POST',
                body: JSON.stringify({ variant }),
              });
              showToast('State reset. Restarting server…');
              await api('/admin/restart', token, { method: 'POST' });
            }),
        },
      ],
    );
  };

  const resolveReview = (reviewId: string, verdict: 'PASS' | 'FAIL') =>
    call(async () => {
      await api(`/admin/review/${reviewId}/resolve`, token, {
        method: 'POST',
        body: JSON.stringify({ verdict }),
      });
      showToast(`Submission marked ${verdict}`);
      void loadReviewQueue();
      void loadLeaderboard();
    });

  // ── Render helpers ──────────────────────────────────────────────────────────
  const teamChip = (
    selected: string,
    setSelected: (v: string) => void,
  ) => (
    <View style={s.chips}>
      {TEAMS.map((t) => (
        <TouchableOpacity
          key={t.id}
          style={[s.chip, selected === t.id && s.chipActive]}
          onPress={() => setSelected(t.id)}
        >
          <Text style={[s.chipText, selected === t.id && s.chipTextActive]}>
            {t.emoji} {t.name}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const statusBtn = (status: GameStatus, label: string, color: string) => (
    <TouchableOpacity
      style={[s.statusBtn, gameStatus === status && { borderColor: color, backgroundColor: `${color}22` }]}
      onPress={() => { if (gameStatus !== status) void setStatus(status); }}
    >
      <Text style={[s.statusBtnText, gameStatus === status && { color }]}>{label}</Text>
    </TouchableOpacity>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // PIN SCREEN
  // ─────────────────────────────────────────────────────────────────────────────
  if (screen === 'pin') {
    return (
      <SafeAreaView style={s.root}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backBtnText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={s.pinContainer}>
          <Text style={s.pinTitle}>🎭 Dictator Mode</Text>
          <Text style={s.pinSub}>Enter 4-digit PIN</Text>
          <View style={s.pinDots}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[s.pinDot, pin.length > i && s.pinDotFilled]} />
            ))}
          </View>
          {authError ? <Text style={s.pinError}>{authError}</Text> : null}
          <View style={s.keypad}>
            {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
              <TouchableOpacity
                key={i}
                style={[s.keypadKey, !k && s.keypadKeyEmpty]}
                onPress={() => k && handlePinKey(k)}
                disabled={!k}
              >
                <Text style={s.keypadKeyText}>{k}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CONNECTING
  // ─────────────────────────────────────────────────────────────────────────────
  if (screen === 'connecting') {
    return (
      <SafeAreaView style={[s.root, s.center]}>
        <ActivityIndicator size="large" color="#f0c040" />
        <Text style={s.connectingText}>Authenticating…</Text>
      </SafeAreaView>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADMIN PANEL
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.backBtnText}>‹</Text></TouchableOpacity>
        <Text style={s.headerTitle}>🎭 Dictator Console</Text>
        <View style={[s.statusPill, { backgroundColor: gameStatus === 'RUNNING' ? '#16a34a' : gameStatus === 'PAUSED' ? '#d97706' : gameStatus === 'ENDED' ? '#6b7280' : '#2563eb' }]}>
          <Text style={s.statusPillText}>{gameStatus}</Text>
        </View>
      </View>

      {/* Toast */}
      {toast ? (
        <View style={s.toast}><Text style={s.toastText}>{toast}</Text></View>
      ) : null}

      {/* Tab bar */}
      <View style={s.tabBar}>
        {(['game','teams','hints','review','log'] as AdminTab[]).map((t) => (
          <TouchableOpacity key={t} style={[s.tabBtn, tab === t && s.tabBtnActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'game' ? '🎮' : t === 'teams' ? '👥' : t === 'hints' ? '💡' : t === 'review' ? '📋' : '📜'}
              {' '}{t.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.panel} keyboardShouldPersistTaps="handled">

          {/* ── GAME TAB ────────────────────────────────────────────── */}
          {tab === 'game' && (
            <View>
              <Text style={s.sectionTitle}>{gameName || 'Game'}</Text>

              <Text style={s.label}>Game Status</Text>
              <View style={s.statusRow}>
                {statusBtn('PENDING', 'PENDING', '#2563eb')}
                {statusBtn('RUNNING', 'START ▶', '#16a34a')}
                {statusBtn('PAUSED', 'PAUSE ⏸', '#d97706')}
                {statusBtn('ENDED', 'END ⏹', '#dc2626')}
              </View>

              <Text style={[s.label, { marginTop: 20 }]}>📢 Broadcast to All Teams</Text>
              <TextInput
                style={s.input}
                placeholder="Message for everyone…"
                placeholderTextColor="#555"
                value={broadcastMsg}
                onChangeText={setBroadcastMsg}
                multiline
              />
              <TouchableOpacity style={s.btn} onPress={sendBroadcast} disabled={busy}>
                <Text style={s.btnText}>Send Broadcast</Text>
              </TouchableOpacity>

              <Text style={[s.label, { marginTop: 24, color: '#f87171' }]}>⚠️ Danger Zone — Reset Game</Text>
              <Text style={s.hint}>Wipes all progress. Only do this before the game starts.</Text>
              <View style={s.dangerRow}>
                <TouchableOpacity style={[s.btn, s.btnDanger, { flex: 1, marginRight: 8 }]} onPress={() => resetSeed('test')}>
                  <Text style={s.btnDangerText}>Reset to TEST</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btn, s.btnDanger, { flex: 1 }]} onPress={() => resetSeed('production')}>
                  <Text style={s.btnDangerText}>Reset to PROD</Text>
                </TouchableOpacity>
              </View>
              <Text style={s.hint}>
                Current seed: <Text style={{ color: gameName.includes('TEST') ? '#fbbf24' : '#34d399' }}>
                  {gameName.includes('TEST') ? 'TEST' : 'PRODUCTION'}
                </Text>
              </Text>
            </View>
          )}

          {/* ── TEAMS TAB ───────────────────────────────────────────── */}
          {tab === 'teams' && (
            <View>
              {/* Leaderboard overview */}
              <Text style={s.sectionTitle}>Live Standings</Text>
              {leaderboard
                .slice()
                .sort((a, b) => b.scoreTotal - a.scoreTotal)
                .map((t, i) => (
                  <View key={t.teamId} style={s.lbRow}>
                    <Text style={s.lbRank}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.lbName}>{t.teamName}</Text>
                      <Text style={s.lbMeta}>Clue {t.currentClueIndex + 1} · {t.completedCount ?? 0} done · {t.skippedCount ?? 0} passed</Text>
                    </View>
                    <Text style={s.lbScore}>{t.scoreTotal ?? 0} pts</Text>
                  </View>
                ))}
              <TouchableOpacity style={[s.btn, s.btnSecondary, { marginBottom: 12 }]} onPress={() => call(() => loadLeaderboard())}>
                <Text style={s.btnSecondaryText}>🔄 Refresh</Text>
              </TouchableOpacity>

              {/* Award / Deduct */}
              <Text style={s.sectionTitle}>Adjust Points</Text>
              <Text style={s.label}>Team</Text>
              {teamChip(ptTeam, setPtTeam)}
              <View style={s.row}>
                <TextInput
                  style={[s.input, { flex: 1, marginRight: 8 }]}
                  placeholder="Amount"
                  placeholderTextColor="#555"
                  keyboardType="numeric"
                  value={ptAmount}
                  onChangeText={setPtAmount}
                />
                <TextInput
                  style={[s.input, { flex: 2 }]}
                  placeholder="Reason"
                  placeholderTextColor="#555"
                  value={ptReason}
                  onChangeText={setPtReason}
                />
              </View>
              <View style={s.row}>
                <TouchableOpacity style={[s.btn, { flex: 1, marginRight: 8, backgroundColor: '#16a34a' }]} onPress={() => awardPoints('award')} disabled={busy}>
                  <Text style={s.btnText}>＋ Award</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btn, { flex: 1, backgroundColor: '#dc2626' }]} onPress={() => awardPoints('deduct')} disabled={busy}>
                  <Text style={s.btnText}>－ Deduct</Text>
                </TouchableOpacity>
              </View>

              {/* Clue navigation */}
              <Text style={[s.sectionTitle, { marginTop: 16 }]}>Reopen / Jump Clue</Text>
              <Text style={s.hint}>Forces a team to a specific clue index (0 = clue 1).</Text>
              {teamChip(advTeam, setAdvTeam)}
              <View style={s.row}>
                <TextInput
                  style={[s.input, { flex: 1, marginRight: 8 }]}
                  placeholder="Clue index (0–11)"
                  placeholderTextColor="#555"
                  keyboardType="numeric"
                  value={advClueIdx}
                  onChangeText={setAdvClueIdx}
                />
                <TouchableOpacity style={[s.btn, { flex: 1 }]} onPress={reopenClue} disabled={busy}>
                  <Text style={s.btnText}>Open Clue</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── HINTS TAB ───────────────────────────────────────────── */}
          {tab === 'hints' && (
            <View>
              <Text style={s.sectionTitle}>Send Clarifying Hint</Text>
              <Text style={s.hint}>
                The hint appears as a highlighted banner in the team's clue view — next to the clue they're currently on.
              </Text>

              <Text style={s.label}>Team</Text>
              {teamChip(hintTeam, setHintTeam)}

              <Text style={s.label}>Clue index (0 = clue 1)</Text>
              <TextInput
                style={s.input}
                placeholder="e.g. 3"
                placeholderTextColor="#555"
                keyboardType="numeric"
                value={hintClueIdx}
                onChangeText={setHintClueIdx}
              />

              <Text style={s.label}>Hint text</Text>
              <TextInput
                style={[s.input, { minHeight: 80 }]}
                placeholder="e.g. Look on the south-facing wall near the entrance…"
                placeholderTextColor="#555"
                multiline
                value={hintText}
                onChangeText={setHintText}
              />

              <TouchableOpacity style={s.btn} onPress={sendHint} disabled={busy || !hintText.trim()}>
                <Text style={s.btnText}>💡 Send Hint</Text>
              </TouchableOpacity>

              {/* Quick clue reference */}
              <Text style={[s.sectionTitle, { marginTop: 20 }]}>Team Clue Positions</Text>
              {leaderboard.map((t) => (
                <View key={t.teamId} style={s.lbRow}>
                  <Text style={s.lbName}>{TEAMS.find((x) => x.id === t.teamId)?.emoji} {t.teamName}</Text>
                  <Text style={s.lbMeta}>currently on clue index {t.currentClueIndex} (Clue {t.currentClueIndex + 1})</Text>
                </View>
              ))}
            </View>
          )}

          {/* ── REVIEW TAB ──────────────────────────────────────────── */}
          {tab === 'review' && (
            <View>
              <Text style={s.sectionTitle}>Needs Review ({reviewQueue.filter((r) => r.status === 'PENDING').length})</Text>
              {busy && <ActivityIndicator color="#f0c040" style={{ marginBottom: 12 }} />}
              {reviewQueue.filter((r) => r.status === 'PENDING').length === 0 && (
                <Text style={s.empty}>No submissions pending review 🎉</Text>
              )}
              {reviewQueue
                .filter((r) => r.status === 'PENDING')
                .map((item) => (
                  <View key={item.id} style={s.reviewCard}>
                    <Text style={s.reviewTeam}>
                      {TEAMS.find((t) => t.id === item.teamId)?.emoji} {item.teamId.toUpperCase()} — Clue {item.clueIndex + 1}
                    </Text>
                    {item.textContent ? (
                      <Text style={s.reviewText}>{item.textContent}</Text>
                    ) : null}
                    {item.mediaUrl ? (
                      <Text style={s.reviewMedia}>📎 {item.mediaUrl}</Text>
                    ) : null}
                    <Text style={s.reviewTime}>{item.createdAt ? new Date(item.createdAt).toLocaleTimeString() : ''}</Text>
                    <View style={s.row}>
                      <TouchableOpacity
                        style={[s.btn, { flex: 1, marginRight: 8, backgroundColor: '#16a34a' }]}
                        onPress={() => resolveReview(item.id, 'PASS')}
                        disabled={busy}
                      >
                        <Text style={s.btnText}>✅ PASS</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.btn, { flex: 1, backgroundColor: '#dc2626' }]}
                        onPress={() => resolveReview(item.id, 'FAIL')}
                        disabled={busy}
                      >
                        <Text style={s.btnText}>❌ FAIL</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={() => call(() => loadReviewQueue())}>
                <Text style={s.btnSecondaryText}>🔄 Refresh Queue</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── LOG TAB ─────────────────────────────────────────────── */}
          {tab === 'log' && (
            <View>
              <Text style={s.sectionTitle}>Audit Log</Text>
              {auditLogs.length === 0 && (
                <Text style={s.empty}>No log entries yet.</Text>
              )}
              {auditLogs.slice().reverse().map((log) => (
                <View key={log.id} style={s.logRow}>
                  <Text style={s.logAction}>{log.action}</Text>
                  <Text style={s.logTarget}>{log.targetId}</Text>
                  {log.reason ? <Text style={s.logReason}>{log.reason}</Text> : null}
                  <Text style={s.logTime}>{log.createdAt ? new Date(log.createdAt).toLocaleTimeString() : ''}</Text>
                </View>
              ))}
              <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={() => call(() => loadAuditLogs())}>
                <Text style={s.btnSecondaryText}>🔄 Refresh</Text>
              </TouchableOpacity>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:            { flex: 1, backgroundColor: '#09090f' },
  center:          { justifyContent: 'center', alignItems: 'center' },

  // Pin screen
  backBtn:         { padding: 16 },
  backBtnText:     { color: '#f0c040', fontSize: 18 },
  pinContainer:    { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  pinTitle:        { fontSize: 26, fontWeight: '800', color: '#f8fafc', marginBottom: 4 },
  pinSub:          { fontSize: 14, color: '#94a3b8', marginBottom: 28 },
  pinDots:         { flexDirection: 'row', gap: 16, marginBottom: 12 },
  pinDot:          { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#334155', backgroundColor: 'transparent' },
  pinDotFilled:    { backgroundColor: '#f0c040', borderColor: '#f0c040' },
  pinError:        { color: '#f87171', fontSize: 13, marginBottom: 12 },
  keypad:          { flexDirection: 'row', flexWrap: 'wrap', width: 240, gap: 12, justifyContent: 'center', marginTop: 8 },
  keypadKey:       { width: 68, height: 68, borderRadius: 34, backgroundColor: '#1e293b', justifyContent: 'center', alignItems: 'center' },
  keypadKeyEmpty:  { backgroundColor: 'transparent' },
  keypadKeyText:   { color: '#f8fafc', fontSize: 22, fontWeight: '700' },
  connectingText:  { color: '#94a3b8', marginTop: 12, fontSize: 15 },

  // Header
  header:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b', gap: 8 },
  headerTitle:     { flex: 1, color: '#f8fafc', fontSize: 17, fontWeight: '700' },
  statusPill:      { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  statusPillText:  { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },

  // Toast
  toast:           { position: 'absolute', top: 80, left: 16, right: 16, backgroundColor: '#1e293b', borderRadius: 10, padding: 12, zIndex: 99, borderWidth: 1, borderColor: '#334155' },
  toastText:       { color: '#f8fafc', fontSize: 13, textAlign: 'center' },

  // Tab bar
  tabBar:          { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1e293b', backgroundColor: '#0f172a' },
  tabBtn:          { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabBtnActive:    { borderBottomWidth: 2, borderBottomColor: '#f0c040' },
  tabText:         { color: '#64748b', fontSize: 10, fontWeight: '600' },
  tabTextActive:   { color: '#f0c040' },

  // Panel
  panel:           { padding: 16, paddingBottom: 48 },
  sectionTitle:    { fontSize: 16, fontWeight: '800', color: '#f8fafc', marginBottom: 12, marginTop: 4 },
  label:           { fontSize: 12, fontWeight: '600', color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  hint:            { fontSize: 12, color: '#475569', marginBottom: 10, lineHeight: 18 },

  // Inputs
  input:           { backgroundColor: '#1e293b', color: '#f8fafc', padding: 12, borderRadius: 8, marginBottom: 10, fontSize: 14, borderWidth: 1, borderColor: '#334155' },
  row:             { flexDirection: 'row', marginBottom: 8 },

  // Chips
  chips:           { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip:            { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  chipActive:      { backgroundColor: '#f0c04022', borderColor: '#f0c040' },
  chipText:        { color: '#64748b', fontSize: 13, fontWeight: '600' },
  chipTextActive:  { color: '#f0c040' },

  // Buttons
  btn:             { backgroundColor: '#f0c040', padding: 12, borderRadius: 8, alignItems: 'center', marginBottom: 8 },
  btnText:         { color: '#09090f', fontWeight: '800', fontSize: 14 },
  btnSecondary:    { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#334155' },
  btnSecondaryText:{ color: '#94a3b8', fontWeight: '700', fontSize: 14 },
  btnDanger:       { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#dc2626' },
  btnDangerText:   { color: '#f87171', fontWeight: '700', fontSize: 13 },

  // Status buttons
  statusRow:       { flexDirection: 'row', gap: 8, marginBottom: 8 },
  statusBtn:       { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#334155', alignItems: 'center' },
  statusBtnText:   { color: '#64748b', fontSize: 11, fontWeight: '700' },
  dangerRow:       { flexDirection: 'row', marginBottom: 8 },

  // Leaderboard
  lbRow:           { backgroundColor: '#1e293b', borderRadius: 8, padding: 10, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  lbRank:          { fontSize: 18, width: 32 },
  lbName:          { color: '#f8fafc', fontWeight: '700', fontSize: 13 },
  lbMeta:          { color: '#64748b', fontSize: 11 },
  lbScore:         { color: '#f0c040', fontWeight: '800', fontSize: 14 },

  // Review
  reviewCard:      { backgroundColor: '#1e293b', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#334155' },
  reviewTeam:      { color: '#f0c040', fontWeight: '800', fontSize: 14, marginBottom: 4 },
  reviewText:      { color: '#cbd5e1', fontSize: 13, marginBottom: 6 },
  reviewMedia:     { color: '#7dd3fc', fontSize: 12, marginBottom: 4 },
  reviewTime:      { color: '#475569', fontSize: 11, marginBottom: 8 },

  // Log
  logRow:          { backgroundColor: '#1e293b', borderRadius: 8, padding: 10, marginBottom: 8 },
  logAction:       { color: '#f0c040', fontWeight: '700', fontSize: 12 },
  logTarget:       { color: '#94a3b8', fontSize: 11 },
  logReason:       { color: '#cbd5e1', fontSize: 12, marginTop: 2 },
  logTime:         { color: '#475569', fontSize: 10, marginTop: 2 },

  empty:           { color: '#475569', textAlign: 'center', marginTop: 24, fontSize: 14 },
});
