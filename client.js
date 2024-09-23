// Get DOM elements
var dataChannelLog = document.getElementById("data-channel"),
  iceConnectionLog = document.getElementById("ice-connection-state"),
  iceGatheringLog = document.getElementById("ice-gathering-state"),
  signalingLog = document.getElementById("signaling-state");

// Peer connectionchannel
var pc = null;

// Data channel
var dc = null,
  dcInterval = null;

  function createPeerConnection() {
    var config = {
      sdpSemantics: "unified-plan",
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    };
  
    pc = new RTCPeerConnection(config);
  
    // Register listeners to update UI logs
    pc.addEventListener("icegatheringstatechange", () => {
      iceGatheringLog.textContent += " -> " + pc.iceGatheringState;
    });
    iceGatheringLog.textContent = pc.iceGatheringState;
  
    pc.addEventListener("iceconnectionstatechange", () => {
      iceConnectionLog.textContent += " -> " + pc.iceConnectionState;
    });
    iceConnectionLog.textContent = pc.iceConnectionState;
  
    pc.addEventListener("signalingstatechange", () => {
      signalingLog.textContent += " -> " + pc.signalingState;
    });
    signalingLog.textContent = pc.signalingState;
  
    // Handle ICE candidates and log them
    pc.onicecandidate = (event) => {
      if (event.candidate === null) {
        console.log("ICE candidate gathering complete");
        connectToRemotePeer(); // Trigger remote peer connection
      } else {
        console.log("New ICE candidate:", event.candidate);
      }
    };
  
    // Handle media tracks
    pc.addEventListener("track", (evt) => {
      if (evt.track.kind === "video") {
        document.getElementById("video").srcObject = evt.streams[0];
      } else {
        document.getElementById("audio").srcObject = evt.streams[0];
      }
    });
  
    return pc;
  }


let candidateCount = 0;
let prevCandidateCount = -1;

function CheckIceCandidates() {
  if (
    pc.iceGatheringState === "complete" ||
    candidateCount === prevCandidateCount
  ) {
    console.log("ICE gathering complete or candidates stable:", candidateCount);
    connectToRemotePeer();
  } else {
    prevCandidateCount = candidateCount;
    setTimeout(CheckIceCandidates, 250);
  }
}

function negotiate() {
  return pc
    .createOffer()
    .then((offer) => {
      return pc.setLocalDescription(offer);
    })
    .then(() => {
      prevCandidateCount = candidateCount;
      setTimeout(CheckIceCandidates, 250);
    });
}

function connectToRemotePeer() {
  var offer = pc.localDescription;
  document.getElementById("offer-sdp").textContent = offer.sdp;
  console.log("Sending offer to Simli API:", offer.sdp);

  return fetch("https://api.simli.ai/StartWebRTCSession", {
    body: JSON.stringify({
      sdp: offer.sdp,
      type: offer.type,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  })
    .then((response) => {
      return response.json();
    })
    .then((answer) => {
      document.getElementById("answer-sdp").textContent = answer.sdp;
      console.log("Received answer from Simli API:", answer.sdp);

      // Check the signaling state before setting remote description
      if (pc.signalingState === "stable") {
        console.warn("PeerConnection is already stable. Remote description not set.");
        return;
      }

      return pc.setRemoteDescription(answer);
    })
    .catch((e) => {
      console.error("Error during WebRTC negotiation:", e);
    });
}

// Modified start function to capture system/browser audio for Read Aloud
function start() {
  document.getElementById("start").style.display = "none";

  pc = createPeerConnection();

  var time_start = null;
  const current_stamp = () => {
    if (time_start === null) {
      time_start = new Date().getTime();
      return 0;
    } else {
      return new Date().getTime() - time_start;
    }
  };

  var parameters = { ordered: true };
  dc = pc.createDataChannel("datachannel", parameters);

  dc.addEventListener("error", (err) => {
    console.error("Data Channel Error:", err);
  });

  dc.addEventListener("close", () => {
    clearInterval(dcInterval);
    dataChannelLog.textContent += "- close\n";
    console.log("Data channel closed");
  });

  dc.addEventListener("open", async () => {
    console.log("Data channel opened with ID:", dc.id);

    // Fetch the API key and face ID from the correct backend port -- Match your set up!
    const response = await fetch("http://127.0.0.1:8081/api/keys");  // Use port 8081 for the backend
    const { api_key, face_id } = await response.json();
    const metadata = {
      faceId: face_id,  // Use the fetched face ID
      isJPG: false,
      apiKey: api_key,  // Use the fetched API key
      syncAudio: true,
    };

    const simliResponse = await fetch(
      "https://api.simli.ai/startAudioToVideoSession",
      {
        method: "POST",
        body: JSON.stringify(metadata),
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    
    const resJSON = await simliResponse.json();
    console.log("Session token received:", resJSON.session_token);
    dc.send(resJSON.session_token);

    dataChannelLog.textContent += "- open\n";

    // Capture and resample audio to 16000 Hz before sending it
    await captureAndSendAudio(dc);

    dcInterval = setInterval(() => {
      var message = "ping " + current_stamp();
      dataChannelLog.textContent += "> " + message + "\n";
      dc.send(message);
    }, 1000);
  });

  dc.addEventListener("message", (evt) => {
    dataChannelLog.textContent += "< " + evt.data + "\n";
    console.log("Message from data channel:", evt.data);

    if (evt.data.substring(0, 4) === "pong") {
      var elapsed_ms = current_stamp() - parseInt(evt.data.substring(5), 10);
      dataChannelLog.textContent += " RTT " + elapsed_ms + " ms\n";
    }
  });

  // Build media constraints to capture system audio from VB-Audio Cable
  const constraints = {
    audio: true, // Capture the default input, which is VB-Audio Cable for system audio
    video: true,
  };

  // Acquire system audio and start negotiation
  document.getElementById("media").style.display = "block";
  navigator.mediaDevices.getUserMedia(constraints).then(
    (stream) => {
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });
      return negotiate();
    },
    (err) => {
      alert("Could not acquire system audio: " + err);
      console.error("Error acquiring audio:", err);
    }
  );
  document.getElementById("stop").style.display = "inline-block";
}

// Function to resample audio to 16000 Hz and send it via the data channel
async function captureAndSendAudio(dc) {
  const desiredSampleRate = 16000;

  console.log("Starting audio capture...");

  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = async (e) => {
      const inputData = e.inputBuffer.getChannelData(0); // Capture raw audio data
      const threshold = 0.01; // Set a small threshold for silence detection

      // Check if the buffer is mostly silent
      const isSilent = inputData.every((sample) => Math.abs(sample) < threshold);

      if (!isSilent) {
        console.log("Non-silent audio detected");

        // Resample the audio to 16 kHz and send it over WebSocket
        const resampledBuffer = await resampleAudioBuffer(
          e.inputBuffer,
          audioContext.sampleRate,
          desiredSampleRate
        );

        const int16Data = new Int16Array(resampledBuffer.length);
        for (let i = 0; i < resampledBuffer.length; i++) {
          int16Data[i] = resampledBuffer[i] * 0x7fff; // Convert float [-1, 1] to Int16 range [-32768, 32767]
        }

        // Log some of the data to verify - turn off to reduce logs
        //console.log("First few samples of Int16 data:", int16Data.slice(0, 10));

        console.log("Sending non-silent audio data over WebSocket...");
        dc.send(int16Data.buffer);
      } else {
        console.log("Silence detected, skipping this frame");
      }
    };
  }).catch((err) => {
    console.error("Error capturing audio:", err);
  });
}

async function resampleAudioBuffer(audioBuffer, inputSampleRate, outputSampleRate) {
  const offlineCtx = new OfflineAudioContext(
    1, // Force mono output by setting the number of channels to 1
    audioBuffer.length * outputSampleRate / inputSampleRate,
    outputSampleRate
  );
  const bufferSource = offlineCtx.createBufferSource();
  bufferSource.buffer = audioBuffer;
  bufferSource.connect(offlineCtx.destination);
  bufferSource.start(0);

  const resampledBuffer = await offlineCtx.startRendering();
  console.log("Resampling complete");
  return resampledBuffer.getChannelData(0); // Ensure that you return mono channel data
}

function stop() {
  document.getElementById("stop").style.display = "none";

  // Close data channel
  if (dc) {
    dc.close();
  }

  // Close transceivers
  if (pc.getTransceivers) {
    pc.getTransceivers().forEach((transceiver) => {
      if (transceiver.stop) {
        transceiver.stop();
      }
    });
  }

  // Close local audio / video
  pc.getSenders().forEach((sender) => {
    sender.track.stop();
  });

  // Close peer connection
  setTimeout(() => {
    pc.close();
    console.log("Peer connection closed");
  }, 500);
}
