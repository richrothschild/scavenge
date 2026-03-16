import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaView, View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Modal, Image, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Camera } from 'expo-camera';
import { BarCodeScanner } from 'expo-barcode-scanner';
import { Video } from 'expo-av';

// Seed data (kept small and representative)
const TEAMS = [
  { id: 'spades', name: 'SPADES', captain: 'Lars', pin: '1111', color: '#1a1a2e', accent: '#4fc3f7', emoji: '♠️' },
  { id: 'hearts', name: 'HEARTS', captain: 'Carl', pin: '2222', color: '#1a0a0a', accent: '#f48fb1', emoji: '♥️' },
  { id: 'diamonds', name: 'DIAMONDS', captain: 'Rich', pin: '3333', color: '#0a1a0a', accent: '#a5d6a7', emoji: '♦️' },
  { id: 'clubs', name: 'CLUBS', captain: 'Dave', pin: '4444', color: '#12100a', accent: '#ffcc80', emoji: '♣️' },
];

const CLUES = [
  { id: 1, title: 'Opening Salvo', instructions: 'Find the sea lion colony near Pier 39. Photograph your full team with at least 3 sea lions visible in the background.', required: false, transport: 'WALK', requiresScan: true, type: 'PHOTO', points: 100 },
  { id: 2, title: "Fisherman's Secret", instructions: "Locate the oldest crab pot display at Fisherman's Wharf. Get a photo with the team recreating the pose of the fisherman statue.", required: false, transport: 'WALK', requiresScan: true, type: 'PHOTO', points: 100 },
  { id: 3, title: 'Giants Proof', instructions: 'Find something that shows the San Francisco Giants. Take a photo including the reference and your full team.', required: false, transport: 'WALK', requiresScan: true, type: 'PHOTO', points: 100 },
];

const SABOTAGE_CATALOG = [
  { id: 's1', name: 'Map Scramble', desc: 'Scramble the target team display.', cost: 50, cooldown: 600, icon: '🗺️' },
  { id: 's2', name: 'Time Bomb', desc: 'Force wait before next submit.', cost: 75, cooldown: 900, icon: '💣' },
];

const initTeamState = () =>
  TEAMS.reduce((acc, t) => {
    acc[t.id] = {
      score: 0,
      sabotageBalance: 200,
      currentClueIndex: 0,
      completedCount: 0,
      skippedCount: 0,
      clueStates: CLUES.map((c) => ({ id: c.id, status: 'LOCKED' })),
      events: [],
      sabotageCooldowns: {},
    };
    acc[t.id].clueStates[0].status = 'ACTIVE';
    return acc;
  }, {} as any);

const ts = () => new Date().toLocaleTimeString();

export default function ScavengeNative() {
  const router = useRouter();
  const [view, setView] = useState<'join' | 'game' | 'admin'>('join');
  const [teamStates, setTeamStates] = useState(initTeamState());
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'clue' | 'leaderboard' | 'sabotage' | 'feed'>('clue');
  const [joinForm, setJoinForm] = useState({ name: '', teamId: 'spades', pin: '' });
  const [, setGlobalEvents] = useState<any[]>([]);
  const notifTimer = useRef<any>(null);
  const [notification, setNotification] = useState<string | null>(null);
  // Camera and scanner state
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [hasBarCodePermission, setHasBarCodePermission] = useState<boolean | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraType, setCameraType] = useState<any>('back');
  const cameraRef = useRef<any>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [capturedVideo, setCapturedVideo] = useState<string | null>(null);
  const [showQRModal, setShowQRModal] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const cam = await Camera.requestCameraPermissionsAsync();
        setHasCameraPermission(cam.status === 'granted');
      } catch {
        setHasCameraPermission(false);
      }
      try {
        const bc = await BarCodeScanner.requestPermissionsAsync();
        setHasBarCodePermission(bc.status === 'granted');
      } catch {
        setHasBarCodePermission(false);
      }
    })();
  }, []);

  const openSubmissionCamera = () => {
    setCapturedPhoto(null);
    setCapturedVideo(null);
    setIsCameraOpen(true);
  };

  const takePhoto = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.6 });
      setCapturedPhoto(photo.uri);
      pushNotif('Photo captured');
    } catch {
      pushNotif('Photo failed');
    }
  };

  const startRecording = async () => {
    if (!cameraRef.current) return;
    try {
      setIsRecording(true);
      const video = await cameraRef.current.recordAsync({ quality: '480p' });
      setCapturedVideo(video.uri);
      setIsRecording(false);
      pushNotif('Video recorded');
    } catch {
      setIsRecording(false);
      pushNotif('Recording failed');
    }
  };

  const stopRecording = async () => {
    try {
      cameraRef.current?.stopRecording();
    } catch {
      pushNotif('Stop failed');
    }
  };

  const closeCameraAndSubmit = () => {
    setIsCameraOpen(false);
    // simulate AI judging after capture
    setTimeout(() => {
      const verdict = Math.random() > 0.2 ? 'PASS' : 'NEEDS_REVIEW';
      if (verdict === 'PASS' && currentUser) {
        advanceClue(currentUser.teamId, 'SUBMIT');
        pushEvent(currentUser.teamId, `✅ Submission accepted (+${myCurrentClue?.points || 0} pts)`);
        pushNotif('Submission accepted');
      } else {
        pushNotif('Submission needs review');
      }
    }, 800);
  };

  const handleQRScan = (data: string) => {
    setShowQRModal(false);
    if (!currentUser) return pushNotif('Join a team first');
    pushEvent(currentUser.teamId, `📱 QR scan: ${data}`);
    pushNotif('QR validated');
  };

  const pushNotif = useCallback((msg: string) => {
    setNotification(msg);
    clearTimeout(notifTimer.current);
    notifTimer.current = setTimeout(() => setNotification(null), 2500);
  }, []);

  const pushEvent = useCallback((teamId: string, msg: string, type = 'progress') => {
    const event = { time: ts(), msg, type, teamId };
    setTeamStates((prev: any) => ({ ...prev, [teamId]: { ...prev[teamId], events: [event, ...prev[teamId].events].slice(0, 50) } }));
    setGlobalEvents((prev) => [event, ...prev].slice(0, 200));
  }, []);

  const pushGlobal = useCallback((msg: string, type = 'system') => {
    const event = { time: ts(), msg, type };
    setGlobalEvents((prev) => [event, ...prev].slice(0, 200));
  }, []);

  const handleJoin = () => {
    if (!joinForm.name.trim()) return pushNotif('Enter a name');
    const team = TEAMS.find((t) => t.id === joinForm.teamId)!;
    let role = 'MEMBER';
    if (joinForm.pin) {
      if (joinForm.pin === team.pin) role = 'CAPTAIN';
      else return pushNotif('Wrong PIN');
    }
    setCurrentUser({ teamId: team.id, name: joinForm.name, role });
    setView('game');
    setActiveTab('clue');
    pushNotif(`Welcome ${joinForm.name} (${role})`);
    pushEvent(team.id, `${joinForm.name} joined as ${role}`);
  };

  const advanceClue = useCallback((teamId: string, mode: 'SUBMIT' | 'PASS') => {
    setTeamStates((prev: any) => {
      const ts = { ...prev[teamId] };
      const idx = ts.currentClueIndex;
      const clue = CLUES[idx];
      const newStates = [...ts.clueStates];
      if (mode === 'PASS') {
        newStates[idx] = { ...newStates[idx], status: 'PASSED' };
        ts.skippedCount += 1;
      } else {
        newStates[idx] = { ...newStates[idx], status: 'COMPLETED' };
        ts.score += clue.points;
        ts.sabotageBalance += Math.floor(clue.points * 0.2);
        ts.completedCount += 1;
      }
      const nextIdx = idx + 1;
      if (nextIdx < CLUES.length) {
        newStates[nextIdx] = { ...newStates[nextIdx], status: 'ACTIVE' };
        ts.currentClueIndex = nextIdx;
      }
      ts.clueStates = newStates;
      return { ...prev, [teamId]: ts };
    });
  }, []);

  

  const handlePass = () => {
    if (!currentUser || currentUser.role !== 'CAPTAIN') return pushNotif('Only captain');
    const idx = teamStates[currentUser.teamId].currentClueIndex;
    const clue = CLUES[idx];
    if (clue.required) return pushNotif('Cannot pass required clue');
    advanceClue(currentUser.teamId, 'PASS');
  };

  const handleSabotage = (action: any, targetTeamId: string) => {
    if (!currentUser) return pushNotif('Login first');
    const my = teamStates[currentUser.teamId];
    if (my.sabotageBalance < action.cost) return pushNotif('Insufficient balance');
    setTeamStates((prev: any) => ({
      ...prev,
      [currentUser.teamId]: { ...prev[currentUser.teamId], sabotageBalance: prev[currentUser.teamId].sabotageBalance - action.cost, sabotageCooldowns: { ...prev[currentUser.teamId].sabotageCooldowns, [action.id]: Date.now() } },
    }));
    pushEvent(currentUser.teamId, `${action.icon} ${currentUser.name || currentUser.teamId} used ${action.name} on ${targetTeamId || 'unknown'}`);
    if (targetTeamId && targetTeamId !== currentUser.teamId) {
      pushEvent(targetTeamId, `💥 You've been hit with ${action.name}!`, 'sabotage');
    }
    pushGlobal(`${action.icon} ${currentUser.name || currentUser.teamId} triggered ${action.name}`);
    pushNotif(`${action.name} triggered`);
  };

  const adminAdvance = (teamId: string) => {
    advanceClue(teamId, 'SUBMIT');
    pushEvent(teamId, `🔧 Admin advanced team to next clue`);
    pushGlobal(`Admin advanced ${teamId}`);
    pushNotif('Team advanced');
  };

  const adminDeduct = (teamId: string, amount = 50) => {
    setTeamStates((prev: any) => ({ ...prev, [teamId]: { ...prev[teamId], score: Math.max(0, prev[teamId].score - amount) } }));
    pushEvent(teamId, `⚠️ Admin deducted ${amount} pts`);
    pushGlobal(`Admin deducted ${amount} pts from ${teamId}`);
    pushNotif(`Deducted ${amount} pts`);
  };

  const myState = currentUser ? teamStates[currentUser.teamId] : null;
  const myClueIdx = myState?.currentClueIndex ?? 0;
  const myCurrentClue = CLUES[myClueIdx];

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>SCAVENGE</Text>
        <Text style={styles.points}>{myState?.score ?? 0} pts</Text>
        <TouchableOpacity onPress={() => router.push('/admin')} style={{ padding: 4 }}>
          <Text style={{ color: '#333', fontSize: 18 }}>⚙</Text>
        </TouchableOpacity>
      </View>

      {notification && (
        <View style={styles.notif}><Text style={styles.notifText}>{notification}</Text></View>
      )}

      {view === 'join' && (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.h1}>Join the Hunt</Text>
          <TextInput style={styles.input} placeholder="Your name" value={joinForm.name} onChangeText={(v) => setJoinForm({ ...joinForm, name: v })} />
          <View style={styles.selectRow}>
            {TEAMS.map((t) => (
              <TouchableOpacity key={t.id} style={[styles.teamBtn, joinForm.teamId === t.id && styles.teamBtnActive]} onPress={() => setJoinForm({ ...joinForm, teamId: t.id })}>
                <Text style={styles.teamEmoji}>{t.emoji}</Text>
                <Text style={styles.teamName}>{t.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={styles.input} placeholder="Captain PIN (optional)" value={joinForm.pin} onChangeText={(v) => setJoinForm({ ...joinForm, pin: v })} secureTextEntry />
          <TouchableOpacity style={styles.primaryBtn} onPress={handleJoin}><Text style={styles.primaryBtnText}>Enter The Hunt</Text></TouchableOpacity>
        </ScrollView>
      )}

      {view === 'game' && currentUser && (
        <View style={{ flex: 1 }}>
          <View style={styles.tabRow}>
            {['clue', 'leaderboard', 'sabotage', 'feed'].map((t) => (
              <TouchableOpacity key={t} style={[styles.tabBtn, activeTab === (t as any) && styles.tabBtnActive]} onPress={() => setActiveTab(t as any)}>
                <Text style={styles.tabText}>{t.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <ScrollView contentContainerStyle={styles.container}>
            {activeTab === 'clue' && (
              <View>
                <View style={styles.card}>
                  <Text style={styles.clueTitle}>{myCurrentClue.title}</Text>
                  <Text style={styles.clueInstructions}>{myCurrentClue.instructions}</Text>
                </View>
                {currentUser.role === 'CAPTAIN' && (
                  <View style={{ marginTop: 12 }}>
                    <TouchableOpacity style={styles.primaryBtn} onPress={openSubmissionCamera}><Text style={styles.primaryBtnText}>Submit Proof</Text></TouchableOpacity>
                    {myCurrentClue?.requiresScan && (
                      <TouchableOpacity style={[styles.ghostBtn, { marginTop: 8 }]} onPress={() => setShowQRModal(true)}><Text style={styles.ghostBtnText}>Scan QR</Text></TouchableOpacity>
                    )}
                    {!myCurrentClue.required && <TouchableOpacity style={styles.ghostBtn} onPress={handlePass}><Text style={styles.ghostBtnText}>Pass this clue</Text></TouchableOpacity>}
                  </View>
                )}
              </View>
            )}

            {activeTab === 'leaderboard' && (
              <View>
                <Text style={styles.h2}>Live Leaderboard</Text>
                {TEAMS.map((team) => (
                  <View key={team.id} style={styles.leaderRow}>
                    <Text style={styles.leaderEmoji}>{team.emoji}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.leaderName}>{team.name}</Text>
                      <Text style={styles.leaderMeta}>Clue {teamStates[team.id].currentClueIndex + 1} · {teamStates[team.id].completedCount} done</Text>
                    </View>
                    <Text style={styles.leaderScore}>{teamStates[team.id].score}</Text>
                  </View>
                ))}
              </View>
            )}

            {activeTab === 'sabotage' && (
              <View>
                <Text style={styles.h2}>Sabotage Store</Text>
                <Text style={{ marginBottom: 8 }}>Balance: {myState?.sabotageBalance ?? 0}</Text>
                {SABOTAGE_CATALOG.map((a) => (
                  <View key={a.id} style={styles.cardSmall}>
                    <Text style={{ fontWeight: '700' }}>{a.icon} {a.name} -{a.cost}</Text>
                    <Text style={{ color: '#666', marginBottom: 8 }}>{a.desc}</Text>
                    {/* target selector */}
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                      {(TEAMS.filter(t => t.id !== currentUser?.teamId)).map(t => (
                        <TouchableOpacity key={t.id} style={[styles.teamBtn, { width: 100, marginRight: 6 }]} onPress={() => handleSabotage(a, t.id)}>
                          <Text style={{ color: '#fff', textAlign: 'center' }}>{t.emoji} {t.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {activeTab === 'feed' && (
              <View>
                <Text style={styles.h2}>Event Feed</Text>
                {(myState?.events || []).map((e: any, i: number) => (
                  <View key={i} style={styles.eventRow}><Text style={{ fontSize: 12 }}>{e.msg}</Text><Text style={{ color: '#888', fontSize: 10 }}>{e.time}</Text></View>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      )}

      {view === 'admin' && (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.h1}>Admin Console</Text>
          <Text style={styles.h2}>Teams</Text>
          {TEAMS.map((t) => (
            <View key={t.id} style={styles.cardSmall}>
              <Text style={{ fontWeight: '700' }}>{t.emoji} {t.name}</Text>
              <Text>Score: {teamStates[t.id].score} · Clue {teamStates[t.id].currentClueIndex + 1}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <TouchableOpacity style={[styles.primaryBtn, { paddingVertical: 8, paddingHorizontal: 10 }]} onPress={() => adminAdvance(t.id)}>
                  <Text style={styles.primaryBtnText}>Advance</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.ghostBtn, { paddingVertical: 8, paddingHorizontal: 10 }]} onPress={() => adminDeduct(t.id, 50)}>
                  <Text style={styles.ghostBtnText}>Deduct 50</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <TouchableOpacity style={[styles.primaryBtn, { marginTop: 12 }]} onPress={() => setView('join')}><Text style={styles.primaryBtnText}>Exit Admin</Text></TouchableOpacity>
        </ScrollView>
      )}

      {/* Camera submission modal */}
      <Modal visible={isCameraOpen} animationType="slide" onRequestClose={() => setIsCameraOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {hasCameraPermission === false && (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: '#fff' }}>Camera permission denied.</Text></View>
          )}
          {hasCameraPermission === null && (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color="#fff" /></View>
          )}
          {hasCameraPermission && (
            (() => {
              const CameraAny: any = Camera;
              return (
                <CameraAny style={{ flex: 1 }} type={cameraType} ref={(r: any) => (cameraRef.current = r)}>
                  <View style={{ position: 'absolute', bottom: 20, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <TouchableOpacity style={styles.ghostBtn} onPress={() => setCameraType((prev: any) => prev === 'back' ? 'front' : 'back')}><Text style={styles.ghostBtnText}>Flip</Text></TouchableOpacity>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  {!isRecording && <TouchableOpacity style={[styles.primaryBtn, { paddingHorizontal: 18 }]} onPress={takePhoto}><Text style={styles.primaryBtnText}>Photo</Text></TouchableOpacity>}
                  {!isRecording && <TouchableOpacity style={[styles.primaryBtn, { paddingHorizontal: 18 }]} onPress={startRecording}><Text style={styles.primaryBtnText}>Record</Text></TouchableOpacity>}
                  {isRecording && <TouchableOpacity style={[styles.ghostBtn, { paddingHorizontal: 18 }]} onPress={stopRecording}><Text style={styles.ghostBtnText}>Stop</Text></TouchableOpacity>}
                </View>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => { setIsCameraOpen(false); }}><Text style={styles.ghostBtnText}>Close</Text></TouchableOpacity>
                    </View>
                </CameraAny>
              );
            })()
          )}
          {/* preview and submit */}
          {(capturedPhoto || capturedVideo) && (
            <View style={{ position: 'absolute', top: 40, left: 16, right: 16 }}>
              {capturedPhoto && <Image source={{ uri: capturedPhoto }} style={{ width: '100%', height: 200, borderRadius: 8 }} />}
              {capturedVideo && <Video source={{ uri: capturedVideo }} style={{ width: '100%', height: 200 }} useNativeControls />}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => { setCapturedPhoto(null); setCapturedVideo(null); }}><Text style={styles.ghostBtnText}>Retake</Text></TouchableOpacity>
                <TouchableOpacity style={styles.primaryBtn} onPress={closeCameraAndSubmit}><Text style={styles.primaryBtnText}>Submit</Text></TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* QR scanner modal */}
      <Modal visible={showQRModal} animationType="slide" onRequestClose={() => setShowQRModal(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {hasBarCodePermission === false && (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: '#fff' }}>QR permission denied.</Text></View>
          )}
          {hasBarCodePermission === null && (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color="#fff" /></View>
          )}
          {hasBarCodePermission && (
            <BarCodeScanner onBarCodeScanned={({ data }) => handleQRScan(data)} style={{ flex: 1 }} />
          )}
          <View style={{ position: 'absolute', top: 40, left: 16 }}>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => setShowQRModal(false)}><Text style={styles.ghostBtnText}>Close</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <View style={styles.footer}>
        <TouchableOpacity onPress={() => setView('join')}><Text style={styles.footerText}>Join</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setView('game')}><Text style={styles.footerText}>Game</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setView('admin')}><Text style={styles.footerText}>Admin</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0f' },
  header: { padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#111' },
  title: { color: '#f0c040', fontSize: 20, fontWeight: '700' },
  points: { color: '#fff', fontSize: 16 },
  container: { padding: 16 },
  h1: { fontSize: 22, color: '#fff', marginBottom: 12 },
  h2: { fontSize: 16, color: '#fff', marginBottom: 8 },
  input: { backgroundColor: '#111', color: '#fff', padding: 10, borderRadius: 6, marginBottom: 12 },
  primaryBtn: { backgroundColor: '#f0c040', padding: 12, borderRadius: 8, alignItems: 'center' },
  primaryBtnText: { color: '#0a0a0f', fontWeight: '700' },
  ghostBtn: { padding: 10, borderRadius: 6, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#333' },
  ghostBtnText: { color: '#ff9d5c' },
  teamBtn: { padding: 8, borderRadius: 8, backgroundColor: '#111', marginRight: 8, alignItems: 'center', width: 80 },
  teamBtnActive: { borderColor: '#f0c040', borderWidth: 1 },
  teamEmoji: { fontSize: 20 },
  teamName: { color: '#fff', fontSize: 12 },
  selectRow: { flexDirection: 'row', marginBottom: 12 },
  tabRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#111' },
  tabBtn: { marginRight: 8, padding: 8 },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: '#f0c040' },
  tabText: { color: '#ccc' },
  card: { backgroundColor: '#111', padding: 12, borderRadius: 8 },
  cardSmall: { backgroundColor: '#111', padding: 8, borderRadius: 6, marginBottom: 8 },
  clueTitle: { color: '#f0c040', fontSize: 18, fontWeight: '700' },
  clueInstructions: { color: '#ddd', marginTop: 8 },
  leaderRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', padding: 10, borderRadius: 8, marginBottom: 8 },
  leaderEmoji: { fontSize: 20, marginRight: 8 },
  leaderName: { color: '#fff', fontWeight: '700' },
  leaderMeta: { color: '#888', fontSize: 12 },
  leaderScore: { color: '#f0c040', fontWeight: '700' },
  eventRow: { backgroundColor: '#111', padding: 8, borderRadius: 6, marginBottom: 6 },
  notif: { position: 'absolute', top: 70, left: 16, right: 16, backgroundColor: '#222', padding: 10, borderRadius: 8, zIndex: 50 },
  notifText: { color: '#fff' },
  footer: { flexDirection: 'row', justifyContent: 'space-around', padding: 12, borderTopWidth: 1, borderTopColor: '#111' },
  footerText: { color: '#ccc' },
});
