// ============================================================
// REACH UP — Effets sonores
// Phase 9 : finition.
//
// Tous les sons sont SYNTHÉTISÉS à la volée via l'API Web Audio —
// aucun fichier audio à héberger. Le contexte audio n'est créé qu'au
// premier son joué (jamais au chargement de la page), pour respecter
// les politiques des navigateurs qui bloquent l'audio avant toute
// interaction de l'utilisateur.
//
// La préférence "son coupé" est mémorisée dans localStorage (ce fichier
// tourne dans un vrai site déployé, pas dans un artifact Claude.ai — le
// stockage navigateur y est donc tout à fait approprié).
// ============================================================

(function () {
  const STORAGE_KEY = "reachup_muted";
  let muted = false;
  try {
    muted = localStorage.getItem(STORAGE_KEY) === "1";
  } catch (err) {
    // localStorage indisponible (navigation privée stricte...) : on démarre avec le son activé.
  }
  let ctx = null;

  function getContext() {
    if (typeof window === "undefined") return null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!ctx) {
      try {
        ctx = new AudioContextClass();
      } catch (err) {
        return null;
      }
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  // Joue une note simple : fréquence, durée, forme d'onde, volume de départ.
  function tone(freq, duration, type = "sine", startGain = 0.15, delay = 0) {
    if (muted) return;
    try {
      const audio = getContext();
      if (!audio) return;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const startTime = audio.currentTime + delay;
      gain.gain.setValueAtTime(startGain, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    } catch (err) {
      // Un son qui échoue ne doit jamais casser le jeu.
    }
  }

  function playDiceRoll() {
    // Deux petits clics percussifs, comme des dés qui s'entrechoquent.
    tone(220, 0.05, "square", 0.08, 0);
    tone(180, 0.05, "square", 0.08, 0.06);
    tone(260, 0.06, "square", 0.08, 0.12);
  }

  function playCoin() {
    // Un petit "ding" brillant, deux notes ascendantes.
    tone(880, 0.12, "sine", 0.12, 0);
    tone(1320, 0.15, "sine", 0.1, 0.05);
  }

  function playCardDraw() {
    // Un léger "whoosh" (glissando descendant rapide).
    if (muted) return;
    try {
      const audio = getContext();
      if (!audio) return;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "triangle";
      const startTime = audio.currentTime;
      osc.frequency.setValueAtTime(700, startTime);
      osc.frequency.exponentialRampToValueAtTime(300, startTime + 0.2);
      gain.gain.setValueAtTime(0.1, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.2);
    } catch (err) {
      // Un son qui échoue ne doit jamais casser le jeu.
    }
  }

  function playError() {
    // Un buzz grave et bref.
    tone(140, 0.18, "sawtooth", 0.09, 0);
  }

  function playVictory() {
    // Petit arpège triomphant.
    tone(523, 0.15, "sine", 0.14, 0);
    tone(659, 0.15, "sine", 0.14, 0.12);
    tone(784, 0.15, "sine", 0.14, 0.24);
    tone(1047, 0.3, "sine", 0.16, 0.36);
  }

  function playClick() {
    tone(500, 0.04, "square", 0.05, 0);
  }

  function isMuted() {
    return muted;
  }

  function setMuted(value) {
    muted = !!value;
    try {
      localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
    } catch (err) {
      // Rien de grave si on ne peut pas mémoriser la préférence.
    }
  }

  function toggleMuted() {
    setMuted(!muted);
    return muted;
  }

  window.ReachUpSounds = {
    playDiceRoll,
    playCoin,
    playCardDraw,
    playError,
    playVictory,
    playClick,
    isMuted,
    setMuted,
    toggleMuted,
  };
})();
