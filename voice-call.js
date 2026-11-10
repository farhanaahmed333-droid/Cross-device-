(() => {
  const $ = (id) => document.getElementById(id);
  const aiForm = $("aiForm");
  if (!aiForm) return;

  const aiInput = $("aiInput");
  const aiMessages = $("aiMessages");
  const aiStatus = $("aiStatus");
  const aiMic = $("aiMic");
  const aiStop = $("aiStop");
  const callStatus = $("callStatus");
  const localVideo = $("localVideo");
  const remoteVideo = $("remoteVideo");
  const history = [];
  let recognition = null;
  let pc = null;
  let localStream = null;
  let pendingCandidates = [];

  function addAiMessage(role, text) {
    const li = document.createElement("li");
    li.className = "message" + (role === "user" ? " mine" : "");
    const body = document.createElement("div");
    body.className = "message-body";
    body.textContent = text;
    li.append(body);
    aiMessages.append(li);
    aiMessages.scrollTop = aiMessages.scrollHeight;
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "bn-BD";
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  }

  async function askArham(text) {
    const clean = text.trim();
    if (!clean) return;
    history.push({ role: "user", content: clean });
    addAiMessage("user", clean);
    aiInput.value = "";
    aiStatus.textContent = "Arham is thinking…";
    try {
      const response = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-20) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Claude API request failed.");
      const reply = String(data.reply || "").trim();
      if (!reply) throw new Error("Claude returned an empty reply.");
      history.push({ role: "assistant", content: reply });
      addAiMessage("assistant", reply);
      aiStatus.textContent = "Connected to Claude.";
      speak(reply);
    } catch (error) {
      aiStatus.textContent = error.message;
      addAiMessage("assistant", "AI connection unavailable: " + error.message);
    }
  }

  aiForm.addEventListener("submit", (event) => {
    event.preventDefault();
    askArham(aiInput.value);
  });

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = "bn-BD";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => { aiMic.textContent = "Listening…"; aiStatus.textContent = "Listening…"; };
    recognition.onresult = (event) => {
      const text = event.results && event.results[0] && event.results[0][0] ? event.results[0][0].transcript : "";
      if (text) askArham(text);
    };
    recognition.onerror = (event) => { aiStatus.textContent = "Microphone speech recognition: " + event.error; };
    recognition.onend = () => { aiMic.textContent = "🎙 Speak"; };
    aiMic.addEventListener("click", () => {
      try { recognition.start(); } catch (_) { aiStatus.textContent = "Microphone is already active."; }
    });
  } else {
    aiMic.disabled = true;
    aiStatus.textContent = "This browser does not support built-in speech recognition. You can still type to Arham.";
  }
  aiStop.addEventListener("click", () => {
    if (recognition) recognition.stop();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    aiStatus.textContent = "Voice stopped.";
  });

  function setCallStatus(text) { callStatus.textContent = text; }
  function signal(payload) {
    if (!window.cdcIsJoined || !window.cdcIsJoined()) {
      setCallStatus("Join a room on this device first.");
      return false;
    }
    return window.cdcSend && window.cdcSend(payload);
  }

  async function ensurePeer(video) {
    if (pc) return pc;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("This browser cannot access the microphone or camera. Use HTTPS and allow permissions.");
    }
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: video ? { facingMode: "user" } : false });
    localVideo.srcObject = localStream;
    pc = new RTCPeerConnection({
      iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]
    });
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    pc.ontrack = (event) => {
      const stream = event.streams && event.streams[0];
      if (stream) remoteVideo.srcObject = stream;
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) signal({ type: "ice_candidate", candidate: event.candidate });
    };
    pc.onconnectionstatechange = () => setCallStatus("Call: " + pc.connectionState);
    return pc;
  }

  async function startCall(video) {
    try {
      if (!window.cdcIsJoined || !window.cdcIsJoined()) {
        setCallStatus("Create or join the same room on both devices first.");
        return;
      }
      const peer = await ensurePeer(video);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      signal({ type: "call_offer", offer });
      setCallStatus(video ? "Video call invitation sent…" : "Audio call invitation sent…");
    } catch (error) {
      setCallStatus(error.message);
      await endCall(false);
    }
  }

  async function endCall(sendSignal = true) {
    if (sendSignal) signal({ type: "call_end" });
    if (pc) { pc.ontrack = null; pc.onicecandidate = null; pc.close(); pc = null; }
    if (localStream) { localStream.getTracks().forEach((track) => track.stop()); localStream = null; }
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    pendingCandidates = [];
    setCallStatus("Call ended.");
  }

  window.addEventListener("cdc-call-signal", async (event) => {
    const data = event.detail || {};
    try {
      if (data.type === "call_offer") {
        const video = Boolean(data.offer && data.offer.sdp && /m=video/.test(data.offer.sdp));
        const peer = await ensurePeer(video);
        await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        signal({ type: "call_answer", answer });
        for (const candidate of pendingCandidates) await peer.addIceCandidate(candidate);
        pendingCandidates = [];
        setCallStatus("Incoming call connected.");
      } else if (data.type === "call_answer" && pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        for (const candidate of pendingCandidates) await pc.addIceCandidate(candidate);
        pendingCandidates = [];
        setCallStatus("Call connected.");
      } else if (data.type === "ice_candidate" && data.candidate) {
        const candidate = new RTCIceCandidate(data.candidate);
        if (pc && pc.remoteDescription) await pc.addIceCandidate(candidate);
        else pendingCandidates.push(candidate);
      } else if (data.type === "call_end") {
        await endCall(false);
      }
    } catch (error) {
      setCallStatus("Call setup failed: " + error.message);
      await endCall(false);
    }
  });

  $("audioCall").addEventListener("click", () => startCall(false));
  $("videoCall").addEventListener("click", () => startCall(true));
  $("endCall").addEventListener("click", () => endCall(true));
  window.addEventListener("beforeunload", () => endCall(false));
})();