// State
let tracks = [];
let currentTrack = null;
let isPlaying = false;
let shuffleActive = false;
let repeatActive = false;
let searchTimeout = null;
let currentView = 'home'; // 'home' or 'favs'
let isAICurated = false; // Track if current results are AI-generated

// Robust Favorites Loading
let favorites = [];
try {
  const saved = localStorage.getItem('soundstat_fav_data');
  if (saved) {
    const parsed = JSON.parse(saved);
    favorites = Array.isArray(parsed)
      ? parsed.filter((f) => f && typeof f === 'object' && f.id)
      : [];
  }
} catch (e) {
  console.error('Favorites load error:', e);
  favorites = [];
}

// Audio & Web Audio API
const audio = new Audio();
audio.crossOrigin = 'anonymous';
let audioCtx = null;
let analyser = null;
let sourceNode = null;
let compressor = null;
let masterGain = null; // Headroom Controller

// FX Nodes
let bassFilter, trebleFilter, midFilter, reverbNode;

// Themes
const themes = [
  { main: '#1DB954', dark: '#0a2a16', glow: 'rgba(29, 185, 84, 0.5)' },
  { main: '#ff416c', dark: '#2a0a14', glow: 'rgba(255, 65, 108, 0.5)' },
  { main: '#00d2ff', dark: '#051937', glow: 'rgba(0, 210, 255, 0.5)' },
  { main: '#9d50bb', dark: '#2a0a2e', glow: 'rgba(157, 80, 187, 0.5)' },
  { main: '#f2994a', dark: '#2a1a0a', glow: 'rgba(242, 153, 74, 0.5)' },
  { main: '#f80759', dark: '#2a0514', glow: 'rgba(248, 7, 89, 0.5)' },
];

// DOM
const songsContainer = document.getElementById('songs-list-container');
const playPauseBtn = document.getElementById('play-pause-mobile');
const floatingPlay = document.getElementById('floating-play');
const nowTitle = document.getElementById('now-title');
const nowArtist = document.getElementById('now-artist');
const progressFill = document.getElementById('progress-fill-micro');
const progressTouch = document.getElementById('progress-touch');
const searchInput = document.getElementById('song-search');
const fsPlayer = document.getElementById('fullscreen-player');
const expandTrigger = document.getElementById('expand-trigger');
const closeFs = document.getElementById('close-fs');
const playerArt = document.getElementById('fs-open-trigger');
const fsArt = document.getElementById('fs-art');
const volumeSlider = document.getElementById('volume-slider');

// Equalizer Canvases
const miniEq = document.getElementById('real-eq');
const fullEq = document.getElementById('fs-real-eq');
const miniCtx = miniEq.getContext('2d');
const fullCtx = fullEq.getContext('2d');

// Initialize
async function init() {
  setupEventListeners();
  await performSearch('Top Global Hits');
  showPersonalizedGreeting();
}

function initAudioContext() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();

    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(2.5, audioCtx.currentTime);

    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, audioCtx.currentTime);
    compressor.knee.setValueAtTime(20, audioCtx.currentTime);
    compressor.ratio.setValueAtTime(8, audioCtx.currentTime);
    compressor.attack.setValueAtTime(0.002, audioCtx.currentTime);
    compressor.release.setValueAtTime(0.15, audioCtx.currentTime);

    bassFilter = audioCtx.createBiquadFilter();
    bassFilter.type = 'lowshelf';
    bassFilter.frequency.value = 150;
    midFilter = audioCtx.createBiquadFilter();
    midFilter.type = 'peaking';
    midFilter.frequency.value = 1000;
    midFilter.Q.value = 0.7;
    trebleFilter = audioCtx.createBiquadFilter();
    trebleFilter.type = 'highshelf';
    trebleFilter.frequency.value = 4000;

    // Cleaner Reverb
    reverbNode = audioCtx.createConvolver();
    const duration = 1.5;
    const rate = audioCtx.sampleRate;
    const length = rate * duration;
    const impulse = audioCtx.createBuffer(2, length, rate);
    for (let i = 0; i < 2; i++) {
      const channel = impulse.getChannelData(i);
      for (let j = 0; j < length; j++) {
        channel[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, 1.5);
      }
    }
    reverbNode.buffer = impulse;

    sourceNode = audioCtx.createMediaElementSource(audio);

    sourceNode.connect(masterGain);
    masterGain.connect(bassFilter);
    bassFilter.connect(midFilter);
    midFilter.connect(trebleFilter);
    trebleFilter.connect(compressor);
    compressor.connect(analyser);
    analyser.connect(audioCtx.destination);

    analyser.fftSize = 128;
    startEqualizer();
  } catch (e) {
    console.error('Audio Context Error:', e);
  }
}

function applyFX(type) {
  if (!audioCtx) initAudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();

  // Smooth transitions
  bassFilter.gain.setTargetAtTime(0, audioCtx.currentTime, 0.2);
  midFilter.gain.setTargetAtTime(0, audioCtx.currentTime, 0.2);
  trebleFilter.gain.setTargetAtTime(0, audioCtx.currentTime, 0.2);
  masterGain.gain.setTargetAtTime(2.5, audioCtx.currentTime, 0.2); // Increased volume

  // Reset Connections
  trebleFilter.disconnect();
  trebleFilter.connect(compressor);

  if (type === 'bass') {
    bassFilter.gain.setTargetAtTime(6, audioCtx.currentTime, 0.2);
    masterGain.gain.setTargetAtTime(2.0, audioCtx.currentTime, 0.2); // Increased volume
  } else if (type === 'rock') {
    bassFilter.gain.setTargetAtTime(4, audioCtx.currentTime, 0.2);
    midFilter.gain.setTargetAtTime(2, audioCtx.currentTime, 0.2);
    trebleFilter.gain.setTargetAtTime(4, audioCtx.currentTime, 0.2);
    masterGain.gain.setTargetAtTime(2.2, audioCtx.currentTime, 0.2);
  } else if (type === 'treble') {
    trebleFilter.gain.setTargetAtTime(6, audioCtx.currentTime, 0.2);
  } else if (type === 'cinema') {
    trebleFilter.disconnect();
    trebleFilter.connect(reverbNode);
    reverbNode.connect(compressor);
    masterGain.gain.setTargetAtTime(0.7, audioCtx.currentTime, 0.2);
  }
}

function startEqualizer() {
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  let hue = 140;

  function draw() {
    requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);
    hue = (hue + 1) % 360;

    const drawBars = (ctx, canvas) => {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        ctx.fillStyle = `hsla(${hue}, 80%, 50%, 0.8)`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }
    };
    drawBars(miniCtx, miniEq);
    drawBars(fullCtx, fullEq);
  }
  draw();
}

async function performSearch(query) {
  if (!query) query = 'Top Global Hits';
  isAICurated = false; // Reset AI flag for regular searches
  try {
    songsContainer.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-dim); grid-column: 1/-1;">
            <i class="fas fa-circle-notch fa-spin" style="font-size: 30px; margin-bottom: 12px;"></i>
            <p>Searching SoundStat AI...</p>
        </div>`;

    const response = await fetch(
      `https://saavn.sumit.co/api/search/songs?query=${encodeURIComponent(query)}&limit=25`,
    );
    const result = await response.json();

    if (result.success && result.data && result.data.results) {
      tracks = result.data.results
        .filter((item) => item.downloadUrl && item.downloadUrl.length > 0)
        .map((item) => {
          const highResImg = item.image[item.image.length - 1].url;
          const highQualAudio =
            item.downloadUrl[item.downloadUrl.length - 1].url;
          return {
            id: String(item.id),
            name: decodeHtml(item.name),
            artist: decodeHtml(
              item.artists.primary[0]?.name || 'Various Artists',
            ),
            album: decodeHtml(item.album.name),
            image: highResImg,
            url: highQualAudio,
            duration: item.duration,
          };
        });
      if (currentView === 'home') renderTracksList();
    }
  } catch (error) {
    console.error('Search failed:', error);
  }
}

function decodeHtml(html) {
  const txt = document.createElement('textarea');
  txt.innerHTML = html;
  return txt.value;
}

function createTrackCard(track, idx) {
  const card = document.createElement('div');
  const isCurrent =
    currentTrack && String(currentTrack.id) === String(track.id);
  const isFav = favorites.some((f) => String(f.id) === String(track.id));
  card.className = `song-card ${isCurrent ? 'active' : ''}`;
  card.innerHTML = `
        <div class="song-index">${idx + 1}</div>
        <img src="${track.image}" style="width: 44px; height: 44px; border-radius: 6px; object-fit: cover;">
        <div class="song-info">
            <div class="song-title">${track.name}</div>
            <div class="song-album">${track.artist}</div>
        </div>
        <button class="fav-btn-card ${isFav ? 'active' : ''}">
            <i class="${isFav ? 'fas' : 'far'} fa-heart"></i>
        </button>
    `;

  card.addEventListener('click', (e) => {
    if (!e.target.closest('.fav-btn-card')) playTrack(track);
  });

  card.querySelector('.fav-btn-card').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavorite(track);
  });
  return card;
}

function renderTracksList() {
  songsContainer.innerHTML = '';
  songsContainer.className = 'songs-grid';
  const listToRender = currentView === 'favs' ? favorites : tracks;

  // Show AI indicator if results are AI-curated
  if (isAICurated && currentView !== 'favs') {
    const aiIndicator = document.createElement('div');
    aiIndicator.style.cssText = 'grid-column: 1/-1; padding: 12px; margin-bottom: 12px; background: rgba(29, 185, 84, 0.1); border: 1px solid rgba(29, 185, 84, 0.3); border-radius: 8px; display: flex; align-items: center; gap: 8px; font-size: 14px; color: #1DB954;';
    aiIndicator.innerHTML = '<i class="fas fa-robot"></i> <span>AI-Curated Recommendations</span> <span style="margin-left: auto; font-size: 12px; opacity: 0.7;">Click genre again to refresh</span>';
    songsContainer.appendChild(aiIndicator);
  }

  if (listToRender.length === 0) {
    songsContainer.innerHTML = `<div style="padding: 60px 20px; text-align: center; color: var(--text-dim); grid-column: 1/-1;">
            <i class="fas fa-${currentView === 'favs' ? 'heart' : 'search'}" style="font-size: 48px; margin-bottom: 20px; opacity: 0.1;"></i>
            <p>${currentView === 'favs' ? 'Your liked songs will appear here' : 'Search for any song, artist or album'}</p>
        </div>`;
    return;
  }

  listToRender.forEach((track, idx) => {
    songsContainer.appendChild(createTrackCard(track, idx));
  });

  if (currentView === 'favs') {
    const headerCount = document.getElementById('fav-count-header');
    if (headerCount) headerCount.innerText = favorites.length;
  }
}

function toggleFavorite(track) {
  const idx = favorites.findIndex((f) => String(f.id) === String(track.id));
  if (idx > -1) {
    favorites.splice(idx, 1);
  } else {
    favorites.push({ ...track });
  }
  localStorage.setItem('soundstat_fav_data', JSON.stringify(favorites));
  renderTracksList();
  updateUI();
}

function playTrack(track) {
  initAudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();

  if (currentTrack && String(currentTrack.id) === String(track.id)) {
    togglePlay();
    return;
  }

  currentTrack = track;
  audio.src = track.url;
  audio.play().catch((e) => console.error('Play error:', e));
  isPlaying = true;

  nowTitle.innerText = track.name;
  nowArtist.innerText = track.artist;
  playerArt.src = track.image;
  fsArt.src = track.image;
  document.getElementById('fs-title').innerText = track.name;
  document.getElementById('fs-album').innerText = track.album;

  applyTheme();
  updateUI();
  renderTracksList();
  addToHistory(track);

  // Trigger AI song suggestion
  generateSuggestion(track).catch((e) => console.error('Suggestion error:', e));

  // Update artist bio if About page is open
  if (currentView === 'about') {
    updateArtistBio(track);
  }
}

async function fetchLyrics() {
  if (!currentTrack) return;
  const content = document.getElementById('lyrics-content');
  content.innerHTML =
    '<i class="fas fa-circle-notch fa-spin"></i><br>Finding lyrics...';

  try {
    const response = await fetch(
      `https://saavn.sumit.co/api/songs/${currentTrack.id}/lyrics`,
    );
    const result = await response.json();
    if (result.success && result.data) {
      content.innerText = decodeHtml(result.data.lyrics);
    } else {
      content.innerText = 'Lyrics not found for this track.';
    }
  } catch (e) {
    content.innerText = 'Error loading lyrics.';
  }
}

async function fetchAIDescription() {
  if (!currentTrack) {
    document.getElementById('ai-desc-content').innerText =
      'Please play a track first to analyze it.';
    return;
  }

  const content = document.getElementById('ai-desc-content');
  content.innerHTML =
    '<i class="fas fa-circle-notch fa-spin"></i><br>AI is analyzing your track...';

  try {
    const result = await puter.ai.chat(
      `As a music analysis AI, analyze the following track and provide:
1. A creative description of the sound (2-3 sentences)
2. 5 relevant genre/mood tags
3. Suggested listening context (when/where to listen)

Track: "${currentTrack.name}" by ${currentTrack.artist}
Album: ${currentTrack.album || 'Unknown'}

Format your response as:
**Description:** [your description]
**Tags:** [tag1, tag2, tag3, tag4, tag5]
**Best for:** [listening context]`,
      { model: "google/gemini-2.5-flash" }
    );
    const text = result.message.content;
    content.innerHTML = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  } catch (error) {
    console.error('Error fetching AI description:', error);
    content.innerText = 'Error analyzing track. Please try again.';
  }
}

async function updateArtistBio(track) {
  if (!track) return;

  // Update current track info display
  document.getElementById('artist-name').innerText = track.artist;
  document.getElementById('artist-image').src = track.image;
  document.getElementById('current-track-name').innerText = track.name;
  document.getElementById('current-track-img').src = track.image;
  document.getElementById('current-track-album').innerText = track.album;

  const bioContent = document.getElementById('artist-bio-content');
  bioContent.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Loading artist biography...';

  try {
    const result = await puter.ai.chat(
      `Write a concise but engaging biography (3-4 sentences) for the artist "${track.artist}". Include their musical style, notable achievements, and what makes them unique. Keep it under 100 words.`,
      { model: "google/gemini-2.5-flash" }
    );
    bioContent.innerText = result.message.content;
  } catch (error) {
    console.error('Error fetching artist bio:', error);
    bioContent.innerText = 'Unable to load artist biography at this time.';
  }
}

// Listening history for personalized greeting
let listeningHistory = [];
try {
  const saved = localStorage.getItem('soundstat_history');
  if (saved) listeningHistory = JSON.parse(saved);
} catch (e) { listeningHistory = []; }

function addToHistory(track) {
  if (!track) return;
  listeningHistory.unshift({
    id: track.id,
    name: track.name,
    artist: track.artist,
    timestamp: Date.now()
  });
  // Keep only last 50 tracks
  listeningHistory = listeningHistory.slice(0, 50);
  localStorage.setItem('soundstat_history', JSON.stringify(listeningHistory));
}

async function showPersonalizedGreeting() {
  const greetingEl = document.getElementById('personalized-greeting');
  if (!greetingEl) return;

  const hour = new Date().getHours();
  let timeGreeting = 'Good evening';
  if (hour < 12) timeGreeting = 'Good morning';
  else if (hour < 18) timeGreeting = 'Good afternoon';

  if (listeningHistory.length === 0) {
    greetingEl.innerText = `${timeGreeting}! Start exploring music to get personalized recommendations.`;
    return;
  }

  try {
    const recentArtists = listeningHistory.slice(0, 5).map(h => h.artist).join(', ');
    const result = await puter.ai.chat(
      `You are a music coach. Based on recent listening to artists like: ${recentArtists}, give a short 1-2 sentence personalized music recommendation for today. Be encouraging and specific.`,
      { model: "google/gemini-2.5-flash" }
    );
    greetingEl.innerText = `${timeGreeting}! ${result.message.content}`;
  } catch (e) {
    greetingEl.innerText = `${timeGreeting}! Ready to discover new music?`;
  }
}

async function analyzeLyrics() {
  if (!currentTrack) return;
  const analysisDiv = document.getElementById('lyrics-analysis');
  const contentDiv = document.getElementById('lyrics-analysis-content');
  if (!analysisDiv || !contentDiv) return;

  analysisDiv.style.display = 'block';
  contentDiv.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> AI is analyzing lyrics...';

  try {
    // First get lyrics
    const lyricsResponse = await fetch(
      `https://saavn.sumit.co/api/songs/${currentTrack.id}/lyrics`
    );
    const lyricsResult = await lyricsResponse.json();

    if (!lyricsResult.success || !lyricsResult.data) {
      contentDiv.innerText = 'Lyrics not available for analysis.';
      return;
    }

    const lyrics = decodeHtml(lyricsResult.data.lyrics);

    // Analyze with AI
    const result = await puter.ai.chat(
      `Analyze the following song lyrics and provide:
1. Main themes (2-3 themes)
2. Overall mood/vibe
3. Key message or story
4. Suitable audience/context

Lyrics:
${lyrics.substring(0, 1500)}

Keep it concise and structured.`,
      { model: "google/gemini-2.5-flash" }
    );
    contentDiv.innerText = result.message.content;
  } catch (error) {
    console.error('Lyrics analysis error:', error);
    contentDiv.innerText = 'Error analyzing lyrics. Please try again.';
  }
}

async function generateMoodPlaylist(mood) {
  const resultsDiv = document.getElementById('mood-playlist-results');
  if (!resultsDiv) return;

  resultsDiv.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> AI is creating your playlist...';

  try {
    const result = await puter.ai.chat(
      `Create a playlist of exactly 10 songs for "${mood}". Return ONLY a comma-separated list of song names with artist (format: "Song Name - Artist"). Example: "Blinding Lights - The Weeknd, Shape of You - Ed Sheeran". No numbering, no extra text.`,
      { model: "google/gemini-2.5-flash" }
    );

    const songList = result.message.content.split(',').map(s => s.trim()).filter(s => s);

    // Search and display each song
    resultsDiv.innerHTML = '<h3 style="margin: 12px 0; color: var(--sp-green);">Your AI Playlist:</h3>';

    for (const song of songList.slice(0, 10)) {
      const songDiv = document.createElement('div');
      songDiv.style.cssText = 'padding: 10px; margin: 8px 0; background: rgba(255,255,255,0.05); border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; align-items: center;';
      songDiv.innerHTML = `<span>${song}</span><i class="fas fa-search" style="color: var(--sp-green);"></i>`;
      songDiv.onclick = () => {
        const query = song.split(' - ')[0] || song;
        document.getElementById('song-search').value = query;
        if (currentView !== 'home') switchView('home');
        performSearch(query);
      };
      resultsDiv.appendChild(songDiv);
    }
  } catch (error) {
    console.error('Playlist generation error:', error);
    resultsDiv.innerText = 'Error generating playlist. Please try again.';
  }
}

async function calculateSongSimilarity(song1Query, song2Query) {
  const resultDiv = document.getElementById('similarity-result');
  const scoreDiv = document.getElementById('similarity-score');
  const explanationDiv = document.getElementById('similarity-explanation');

  if (!resultDiv || !scoreDiv || !explanationDiv) return;

  resultDiv.style.display = 'block';
  scoreDiv.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
  explanationDiv.innerText = '';

  try {
    const result = await puter.ai.chat(
      `Compare these two songs and give a similarity score from 0-100% based on genre, mood, tempo, and style.

Song 1: ${song1Query}
Song 2: ${song2Query}

Return ONLY the numeric score followed by a brief explanation.
Format: "75%" on first line, then explanation on next lines.`,
      { model: "google/gemini-2.5-flash" }
    );

    const response = result.message.content;
    const lines = response.split('\n');
    const scoreLine = lines[0] || '50%';
    const explanation = lines.slice(1).join('\n') || 'These songs have moderate similarity.';

    scoreDiv.innerText = scoreLine;
    explanationDiv.innerText = explanation;
  } catch (error) {
    console.error('Similarity error:', error);
    scoreDiv.innerText = 'Error';
    explanationDiv.innerText = 'Unable to calculate similarity. Please try again.';
  }
}

function applyTheme() {
  const themeIndex =
    Math.abs(
      String(currentTrack.id)
        .split('')
        .reduce((acc, char) => acc + char.charCodeAt(0), 0),
    ) % themes.length;
  const theme = themes[themeIndex];
  document.documentElement.style.setProperty('--theme-color', theme.main);
  document.documentElement.style.setProperty('--theme-color-dark', theme.dark);
  document.documentElement.style.setProperty('--theme-glow', theme.glow);
}

function togglePlay() {
  initAudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();

  if (!audio.src) {
    const list = currentView === 'favs' ? favorites : tracks;
    if (list.length > 0) playTrack(list[0]);
    return;
  }
  if (audio.paused) {
    audio
      .play()
      .then(() => {
        isPlaying = true;
        updateUI();
      })
      .catch(() => (isPlaying = false));
  } else {
    audio.pause();
    isPlaying = false;
  }
  updateUI();
}

function updateUI() {
  const icon = isPlaying
    ? '<i class="fas fa-pause"></i>'
    : '<i class="fas fa-play"></i>';
  playPauseBtn.innerHTML = icon;
  document.getElementById('fs-play').innerHTML = icon;
  if (floatingPlay) floatingPlay.innerHTML = icon;

  const fsArtEl = document.getElementById('fs-art');
  if (isPlaying) fsArtEl.classList.add('rotating');
  else fsArtEl.classList.remove('rotating');

  const isFav =
    currentTrack &&
    favorites.some((f) => String(f.id) === String(currentTrack.id));
  const favIcon = isFav
    ? '<i class="fas fa-heart" style="color:#1DB954;"></i>'
    : '<i class="far fa-heart"></i>';
  document.getElementById('fs-fav').innerHTML = favIcon;
  document.getElementById('fav-toggle-mobile').innerHTML = favIcon;
}

audio.addEventListener('timeupdate', () => {
  if (audio.duration) {
    const percent = (audio.currentTime / audio.duration) * 100;
    progressFill.style.width = `${percent}%`;
    document.getElementById('fs-progress-fill').style.width = `${percent}%`;
    document.getElementById('fs-current').innerText = formatTime(
      audio.currentTime,
    );
    document.getElementById('fs-duration').innerText = formatTime(
      audio.duration,
    );
  }
});

function formatTime(sec) {
  if (!sec) return '0:00';
  let m = Math.floor(sec / 60),
    s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function nextSong() {
  const list = currentView === 'favs' ? favorites : tracks;
  if (list.length === 0) return;
  let idx = list.findIndex((t) => String(t.id) === String(currentTrack?.id));
  if (shuffleActive) idx = Math.floor(Math.random() * list.length);
  else idx = (idx + 1) % list.length;
  playTrack(list[idx]);
}

function prevSong() {
  const list = currentView === 'favs' ? favorites : tracks;
  if (list.length === 0) return;
  let idx = list.findIndex((t) => String(t.id) === String(currentTrack?.id));
  idx = (idx - 1 + list.length) % list.length;
  playTrack(list[idx]);
}



// AI Song Suggestion Functions
async function generateSuggestion(track) {
  try {
    // Use AI to analyze mood/genre and suggest what type of songs to search for
    const aiSuggestion = await puter.ai.chat(
      `As a music recommendation AI, analyze this track and suggest what kind of songs would go well with it. Provide a short search query (2-4 words) that captures the mood, genre, or vibe.

Track: "${track.name}" by ${track.artist}
Album: ${track.album || 'Unknown'}

Return ONLY the search query, nothing else. Example: "chill indie pop" or "energetic rock" or "melancholic ballads"`,
      { model: "google/gemini-2.5-flash" }
    );

    const searchQuery = aiSuggestion.message.content.trim();
    if (!searchQuery) return;

    // Search for songs based on AI recommendation
    const response = await fetch(
      `https://saavn.sumit.co/api/search/songs?query=${encodeURIComponent(searchQuery)}&limit=25`,
    );
    const result = await response.json();

    if (!result.success || !result.data.results) return;

    // Map results to track objects, filter out current track
    const similarTracks = result.data.results
      .filter(
        (item) =>
          String(item.id) !== String(track.id) &&
          item.downloadUrl &&
          item.downloadUrl.length > 0,
      )
      .map((item) => {
        const highResImg = item.image[item.image.length - 1].url;
        const highQualAudio = item.downloadUrl[item.downloadUrl.length - 1].url;
        return {
          id: String(item.id),
          name: decodeHtml(item.name),
          artist: decodeHtml(
            item.artists.primary[0]?.name || 'Various Artists',
          ),
          album: decodeHtml(item.album.name),
          image: highResImg,
          url: highQualAudio,
          duration: item.duration,
        };
      });

    if (similarTracks.length === 0) return;

    // Pick a random similar track
    const suggestedTrack =
      similarTracks[Math.floor(Math.random() * similarTracks.length)];

    // Show toast notification
    showToast(suggestedTrack);
  } catch (error) {
    console.error('Error generating song suggestion:', error);
  }
}

function showToast(track) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  const isFav = favorites.some((f) => String(f.id) === String(track.id));
  toast.innerHTML = `
        <div class="toast-header">🎵 Suggested Next</div>
        <img src="${track.image}" class="toast-album-art" alt="Album Art">
        <div class="toast-info">
            <div class="toast-title">${track.name}</div>
            <div class="toast-artist">${track.artist}</div>
        </div>
        <div class="toast-actions">
            <button class="toast-fav-btn ${isFav ? 'active' : ''}" data-track-id="${track.id}"><i class="${isFav ? 'fas' : 'far'} fa-heart"></i></button>
            <button class="toast-play-btn" data-track-id="${track.id}"><i class="fas fa-play"></i></button>
            <button class="toast-close-btn"><i class="fas fa-times"></i></button>
        </div>
    `;

  container.appendChild(toast);

  // Favorite button click handler
  toast.querySelector('.toast-fav-btn').addEventListener('click', () => {
    toggleFavorite(track);
    hideToast(toast);
  });

  // Play button click handler
  toast.querySelector('.toast-play-btn').addEventListener('click', () => {
    playTrack(track);
    hideToast(toast);
  });

  // Close button click handler
  toast.querySelector('.toast-close-btn').addEventListener('click', () => {
    hideToast(toast);
  });

  // Auto-hide after 10 seconds
  setTimeout(() => {
    if (toast.parentNode) hideToast(toast);
  }, 10000);
}

function hideToast(toast) {
  if (!toast || toast.classList.contains('hiding')) return;
  toast.classList.add('hiding');
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 500);
}

function setupEventListeners() {
  searchInput.addEventListener('input', (e) => {
    if (currentView !== 'home' && e.target.value.trim() !== '') {
      switchView('home');
    }
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => performSearch(e.target.value), 600);
  });

  // Voice Search
  const voiceBtn = document.getElementById('voice-search-btn');
  if (voiceBtn && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    voiceBtn.addEventListener('click', () => {
      if (recognition.isRunning) {
        recognition.stop();
        voiceBtn.classList.remove('listening');
        voiceBtn.style.color = '#b3b3b3';
        return;
      }

      recognition.start();
      voiceBtn.classList.add('listening');
      voiceBtn.style.color = '#1DB954';
      searchInput.placeholder = 'Listening...';

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        searchInput.value = transcript;
        voiceBtn.classList.remove('listening');
        voiceBtn.style.color = '#b3b3b3';
        searchInput.placeholder = 'Search music...';
        performSearch(transcript);
      };

      recognition.onerror = () => {
        voiceBtn.classList.remove('listening');
        voiceBtn.style.color = '#b3b3b3';
        searchInput.placeholder = 'Search music...';
      };

      recognition.onend = () => {
        voiceBtn.classList.remove('listening');
        voiceBtn.style.color = '#b3b3b3';
        searchInput.placeholder = 'Search music...';
      };
    });
  } else if (voiceBtn) {
    // Voice search not supported - show tooltip but keep visible
    voiceBtn.style.opacity = '0.6';
    voiceBtn.style.cursor = 'not-allowed';
    voiceBtn.title = 'Voice search not supported in this browser';
    voiceBtn.addEventListener('click', () => {
      alert('Voice search is not supported in your browser. Try Chrome or Edge.');
    });
  }

  const switchView = (view) => {
    currentView = view;
    document
      .querySelectorAll('.nav-link')
      .forEach((l) => l.classList.remove('active'));
    const navEl = document.getElementById('nav-' + view);
    if (navEl) navEl.classList.add('active');

    const hero = document.getElementById('hero-section');
    const favs = document.getElementById('favs-section');
    const aboutPage = document.getElementById('about-page');
    const aiPromptsSection = document.getElementById('ai-prompts-section');
    const artistBioSection = document.getElementById('artist-bio-section');
    const defaultAboutSection = document.getElementById('default-about-section');

    if (hero) hero.style.display = view === 'home' ? 'block' : 'none';
    if (favs) favs.style.display = view === 'favs' ? 'block' : 'none';
    if (aboutPage) aboutPage.classList.toggle('active', view === 'about');
    if (aiPromptsSection)
      aiPromptsSection.style.display = view === 'about' ? 'block' : 'none';

    // Show artist bio if on About page and track is playing
    if (view === 'about' && currentTrack) {
      if (artistBioSection) artistBioSection.style.display = 'block';
      if (defaultAboutSection) defaultAboutSection.style.display = 'none';
      updateArtistBio(currentTrack);
    } else if (view === 'about') {
      if (artistBioSection) artistBioSection.style.display = 'none';
      if (defaultAboutSection) defaultAboutSection.style.display = 'block';
    } else {
      if (artistBioSection) artistBioSection.style.display = 'none';
      if (defaultAboutSection) defaultAboutSection.style.display = 'block';
    }

    // Only render tracks list if not on the 'about' view
    if (view !== 'about') {
      renderTracksList();
    }
  };

  document.getElementById('nav-home').addEventListener('click', (e) => {
    e.preventDefault();
    switchView('home');
    // Close sidebar if open
    const moodSidebar = document.getElementById('mood-sidebar');
    const moodSidebarOverlay = document.getElementById('mood-sidebar-overlay');
    if (moodSidebar) moodSidebar.classList.remove('open');
    if (moodSidebarOverlay) moodSidebarOverlay.classList.remove('open');
  });
  document.getElementById('nav-favs').addEventListener('click', (e) => {
    e.preventDefault();
    switchView('favs');
    // Close sidebar if open
    const moodSidebar = document.getElementById('mood-sidebar');
    const moodSidebarOverlay = document.getElementById('mood-sidebar-overlay');
    if (moodSidebar) moodSidebar.classList.remove('open');
    if (moodSidebarOverlay) moodSidebarOverlay.classList.remove('open');
    // Reset sidebar active state
    document.querySelectorAll('.mood-chip-sidebar').forEach((c) => c.classList.remove('active'));
  });
  document.getElementById('nav-about').addEventListener('click', (e) => {
    e.preventDefault();
    switchView('about');
    // Close sidebar if open
    const moodSidebar = document.getElementById('mood-sidebar');
    const moodSidebarOverlay = document.getElementById('mood-sidebar-overlay');
    if (moodSidebar) moodSidebar.classList.remove('open');
    if (moodSidebarOverlay) moodSidebarOverlay.classList.remove('open');
  });

  // Modal Toggle Functions
  const toggleFX = () => {
    document.getElementById('fx-modal').classList.toggle('open');
    document.getElementById('fx-overlay').classList.toggle('open');
  };

  const toggleLyrics = () => {
    const modal = document.getElementById('lyrics-modal');
    const overlay = document.getElementById('lyrics-overlay');
    const isOpen = modal.classList.toggle('open');
    overlay.style.display = isOpen ? 'block' : 'none';
    if (isOpen) fetchLyrics();
  };

  const toggleAIDesc = () => {
    const modal = document.getElementById('ai-desc-modal');
    const overlay = document.getElementById('ai-desc-overlay');
    const isOpen = modal.classList.toggle('open');
    overlay.style.display = isOpen ? 'block' : 'none';
    if (isOpen && currentTrack) {
      fetchAIDescription();
    }
  };

  // FX Modal event listeners
  document.getElementById('fx-trigger-mobile').addEventListener('click', toggleFX);
  document.getElementById('fs-fx').addEventListener('click', toggleFX);
  document.getElementById('fx-overlay').addEventListener('click', toggleFX);

  // FX Options event listeners
  document.querySelectorAll('.fx-option-mobile').forEach((opt) => {
    opt.addEventListener('click', () => {
      document
        .querySelectorAll('.fx-option-mobile')
        .forEach((o) => o.classList.remove('active'));
      opt.classList.add('active');
      applyFX(opt.dataset.fx);
      setTimeout(toggleFX, 300);
    });
  });

  // Lyrics Modal event listeners
  document.getElementById('fs-lyrics').addEventListener('click', toggleLyrics);
  document.getElementById('close-lyrics').addEventListener('click', toggleLyrics);
  document.getElementById('lyrics-overlay').addEventListener('click', toggleLyrics);

  // AI Description Modal event listeners
  document.getElementById('fs-ai-describe').addEventListener('click', toggleAIDesc);
  document.getElementById('close-ai-desc').addEventListener('click', toggleAIDesc);
  document.getElementById('ai-desc-overlay').addEventListener('click', toggleAIDesc);

  // Event listener for AI prompt generation
  const aiPromptInput = document.getElementById('ai-prompt-input');
  const generateAiPromptBtn = document.getElementById('generate-ai-prompt');
  const aiPromptOutput = document.getElementById('ai-prompt-output');

  if (generateAiPromptBtn) {
    generateAiPromptBtn.addEventListener('click', async () => {
      const prompt = aiPromptInput.value.trim();
      if (!prompt) {
        aiPromptOutput.style.display = 'block';
        aiPromptOutput.innerText = 'Please enter a prompt!';
        return;
      }

      aiPromptOutput.style.display = 'block';
      aiPromptOutput.innerHTML =
        '<i class="fas fa-circle-notch fa-spin"></i> Generating suggestions...';
      generateAiPromptBtn.disabled = true;

      try {
        const result = await puter.ai.chat(
          `As a creative sound design assistant for a music app, generate unique and inspiring sound ideas based on the following theme. Provide a concise, imaginative suggestion.

Theme: "${prompt}"

Example Output:
- Suggest a soundscape that blends the gentle hum of ancient machinery with the delicate chimes of a wind harp, evoking a sense of forgotten innovation.
- Propose a beat crafted from the rhythmic drip of water in a cavern, layered with the distant echoes of whale song, for a mysterious underwater track.

Now, generate a creative sound prompt for the theme:`,
          { model: "google/gemini-2.5-flash" }
        );
        aiPromptOutput.innerText = result.message.content;
      } catch (error) {
        console.error('Error generating AI prompt:', error);
        aiPromptOutput.innerText =
          'Error generating suggestions. Please try again.';
      } finally {
        generateAiPromptBtn.disabled = false;
      }
    });
  }

  playPauseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlay();
  });
  floatingPlay.addEventListener('click', togglePlay);
  document.getElementById('fs-play').addEventListener('click', togglePlay);
  document.getElementById('fs-next').addEventListener('click', nextSong);
  document.getElementById('fs-prev').addEventListener('click', prevSong);
  document.getElementById('next-mobile').addEventListener('click', (e) => {
    e.stopPropagation();
    nextSong();
  });
  document.getElementById('prev-mobile').addEventListener('click', (e) => {
    e.stopPropagation();
    prevSong();
  });

  expandTrigger.addEventListener('click', () =>
    fsPlayer.classList.add('active'),
  );
  closeFs.addEventListener('click', () => fsPlayer.classList.remove('active'));

  volumeSlider.addEventListener('input', (e) => {
    if (audioCtx && masterGain) {
      masterGain.gain.setTargetAtTime(
        parseFloat(e.target.value) * 2.5,
        audioCtx.currentTime,
        0.05,
      );
    }
  });

  // Sidebar toggle for mobile mood genres
  const moodMenuTrigger = document.getElementById('mood-menu-trigger');
  const moodSidebar = document.getElementById('mood-sidebar');
  const moodSidebarOverlay = document.getElementById('mood-sidebar-overlay');
  const closeMoodSidebar = document.getElementById('close-mood-sidebar');

  if (moodMenuTrigger) {
    moodMenuTrigger.addEventListener('click', () => {
      if (moodSidebar) moodSidebar.classList.add('open');
      if (moodSidebarOverlay) moodSidebarOverlay.classList.add('open');
    });
  }

  if (closeMoodSidebar) {
    closeMoodSidebar.addEventListener('click', () => {
      if (moodSidebar) moodSidebar.classList.remove('open');
      if (moodSidebarOverlay) moodSidebarOverlay.classList.remove('open');
    });
  }

  if (moodSidebarOverlay) {
    moodSidebarOverlay.addEventListener('click', () => {
      if (moodSidebar) moodSidebar.classList.remove('open');
      if (moodSidebarOverlay) moodSidebarOverlay.classList.remove('open');
    });
  }

  // Sidebar mood chip event listeners
  document.querySelectorAll('.mood-chip-sidebar').forEach((chip) => {
    chip.addEventListener('click', async () => {
      // Update active state in sidebar
      document.querySelectorAll('.mood-chip-sidebar').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');

      // Also update desktop mood bar if visible
      document.querySelectorAll('.mood-chip').forEach((c) => {
        c.classList.remove('active');
        if (c.dataset.mood === chip.dataset.mood) c.classList.add('active');
      });

      // Close sidebar on mobile
      if (window.innerWidth <= 768) {
        if (moodSidebar) moodSidebar.classList.remove('open');
        if (moodSidebarOverlay) moodSidebarOverlay.classList.remove('open');
      }

      if (currentView !== 'home') switchView('home');

      // Show loading state
      songsContainer.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-dim); grid-column: 1/-1;">
        <i class="fas fa-circle-notch fa-spin" style="font-size: 30px; margin-bottom: 12px;"></i>
        <p><i class="fas fa-robot"></i> AI is curating ${chip.dataset.mood} songs...</p>
      </div>`;

      try {
        const result = await puter.ai.chat(
          `Create a list of exactly 25 popular songs for the mood/genre: "${chip.dataset.mood}".
Return ONLY a comma-separated list of song names with artist (format: "Song Name - Artist").
Example: "Blinding Lights - The Weeknd, Shape of You - Ed Sheeran, Someone Like You - Adele"
No numbering, no extra text, just the list.`,
          { model: "google/gemini-2.5-flash" }
        );

        const songList = result.message.content.split(',').map(s => s.trim()).filter(s => s);
        const uniqueSongs = [...new Set(songList)];

        const searchPromises = uniqueSongs.slice(0, 25).map(async (song) => {
          const query = song.split(' - ')[0] || song;
          try {
            const response = await fetch(
              `https://saavn.sumit.co/api/search/songs?query=${encodeURIComponent(query)}&limit=10`
            );
            const result = await response.json();
            if (result.success && result.data && result.data.results && result.data.results.length > 0) {
              return result.data.results.slice(0, 2)
                .filter(item => item.downloadUrl && item.downloadUrl.length > 0)
                .map(item => {
                  const highResImg = item.image[item.image.length - 1].url;
                  const highQualAudio = item.downloadUrl[item.downloadUrl.length - 1].url;
                  return {
                    id: String(item.id),
                    name: decodeHtml(item.name),
                    artist: decodeHtml(item.artists.primary[0]?.name || 'Various Artists'),
                    album: decodeHtml(item.album.name),
                    image: highResImg,
                    url: highQualAudio,
                    duration: item.duration,
                  };
                });
            }
          } catch (e) {
            return [];
          }
          return [];
        });

        const searchResults = await Promise.all(searchPromises);
        let allTracks = searchResults.flat();

        const seenIds = new Set();
        allTracks = allTracks.filter(track => {
          if (seenIds.has(track.id)) return false;
          seenIds.add(track.id);
          return true;
        });

        if (allTracks.length >= 20) {
          tracks = allTracks.slice(0, 25);
          isAICurated = true;
          renderTracksList();
        } else if (allTracks.length > 0) {
          tracks = allTracks;
          isAICurated = true;
          const backupResult = await fetch(
            `https://saavn.sumit.co/api/search/songs?query=${encodeURIComponent(chip.dataset.mood)}&limit=50`
          );
          const backupData = await backupResult.json();
          if (backupData.success && backupData.data && backupData.data.results) {
            const extraTracks = backupData.data.results
              .filter(item =>
                item.downloadUrl && item.downloadUrl.length > 0 &&
                !seenIds.has(String(item.id))
              )
              .slice(0, 25 - allTracks.length)
              .map(item => {
                const highResImg = item.image[item.image.length - 1].url;
                const highQualAudio = item.downloadUrl[item.downloadUrl.length - 1].url;
                return {
                  id: String(item.id),
                  name: decodeHtml(item.name),
                  artist: decodeHtml(item.artists.primary[0]?.name || 'Various Artists'),
                  album: decodeHtml(item.album.name),
                  image: highResImg,
                  url: highQualAudio,
                  duration: item.duration,
                };
              });
            tracks = [...tracks, ...extraTracks];
          }
          renderTracksList();
        } else {
          isAICurated = false;
          performSearch(chip.dataset.mood);
        }
      } catch (error) {
        console.error('AI mood search error:', error);
        isAICurated = false;
        performSearch(chip.dataset.mood);
      }

      document.getElementById('main-scroll-area').scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Favorite button event listeners
  document.getElementById('fs-fav').addEventListener('click', () => {
    if (currentTrack) toggleFavorite(currentTrack);
  });
  document.getElementById('fav-toggle-mobile').addEventListener('click', () => {
    if (currentTrack) toggleFavorite(currentTrack);
  });

  const seek = (e, container) => {
    if (!audio.duration) return;
    const rect = container.getBoundingClientRect();
    const x = (e.clientX || (e.touches && e.touches[0].clientX)) - rect.left;
    const pct = Math.min(Math.max(x / rect.width, 0), 1);
    audio.currentTime = pct * audio.duration;
  };
  progressTouch.addEventListener('click', (e) => seek(e, progressTouch));
  document
    .getElementById('fs-progress-touch')
    .addEventListener('click', (e) =>
      seek(e, document.getElementById('fs-progress-touch')),
    );

  document.getElementById('shuffle-mobile').addEventListener('click', (e) => {
    e.stopPropagation();
    shuffleActive = !shuffleActive;
    document.getElementById('shuffle-mobile').style.opacity = shuffleActive
      ? '1'
      : '0.6';
    document
      .getElementById('shuffle-mobile')
      .classList.toggle('active', shuffleActive);
  });
  document.getElementById('fs-shuffle').addEventListener('click', () => {
    shuffleActive = !shuffleActive;
    document.getElementById('fs-shuffle').style.opacity = shuffleActive
      ? '1'
      : '0.6';
    document
      .getElementById('fs-shuffle')
      .classList.toggle('active', shuffleActive);
  });
  document.getElementById('fs-repeat').addEventListener('click', () => {
    repeatActive = !repeatActive;
    audio.loop = repeatActive;
    document.getElementById('fs-repeat').style.opacity = repeatActive
      ? '1'
      : '0.6';
  });

  // Lyrics AI Analysis
  const lyricsAnalyzeBtn = document.getElementById('lyrics-analyze');
  if (lyricsAnalyzeBtn) {
    lyricsAnalyzeBtn.addEventListener('click', () => {
      analyzeLyrics();
    });
  }

  // Mood Playlist Generator
  document.querySelectorAll('.mood-playlist-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      generateMoodPlaylist(btn.dataset.mood);
    });
  });

  // Song Similarity Modal
  const openSimModal = document.getElementById('open-similarity-modal');
  const simModal = document.getElementById('similarity-modal');
  const simOverlay = document.getElementById('similarity-overlay');
  const closeSim = document.getElementById('close-similarity');
  const calcSim = document.getElementById('calculate-similarity');

  if (openSimModal) {
    openSimModal.addEventListener('click', () => {
      if (simModal) simModal.style.display = 'block';
      if (simOverlay) simOverlay.style.display = 'block';
    });
  }
  if (closeSim) {
    closeSim.addEventListener('click', () => {
      if (simModal) simModal.style.display = 'none';
      if (simOverlay) simOverlay.style.display = 'none';
    });
  }
  if (simOverlay) {
    simOverlay.addEventListener('click', () => {
      if (simModal) simModal.style.display = 'none';
      if (simOverlay) simOverlay.style.display = 'none';
    });
  }
  if (calcSim) {
    calcSim.addEventListener('click', () => {
      const song1 = document.getElementById('similarity-song1').value.trim();
      const song2 = document.getElementById('similarity-song2').value.trim();
      if (song1 && song2) {
        calculateSongSimilarity(song1, song2);
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowRight':
        e.preventDefault();
        nextSong();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        prevSong();
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (audioCtx && masterGain) {
          const newVol = Math.min(1, parseFloat(volumeSlider.value) + 0.1);
          volumeSlider.value = newVol;
          masterGain.gain.setTargetAtTime(
            newVol * 2.5,
            audioCtx.currentTime,
            0.05,
          );
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (audioCtx && masterGain) {
          const newVol = Math.max(0, parseFloat(volumeSlider.value) - 0.1);
          volumeSlider.value = newVol;
          masterGain.gain.setTargetAtTime(
            newVol * 2.5,
            audioCtx.currentTime,
            0.05,
          );
        }
        break;
      case 'KeyS':
        e.preventDefault();
        shuffleActive = !shuffleActive;
        document.getElementById('shuffle-mobile').style.opacity = shuffleActive
          ? '1'
          : '0.6';
        document
          .getElementById('shuffle-mobile')
          .classList.toggle('active', shuffleActive);
        document.getElementById('fs-shuffle').style.opacity = shuffleActive
          ? '1'
          : '0.6';
        document
          .getElementById('fs-shuffle')
          .classList.toggle('active', shuffleActive);
        break;
      case 'KeyR':
        e.preventDefault();
        repeatActive = !repeatActive;
        audio.loop = repeatActive;
        document.getElementById('fs-repeat').style.opacity = repeatActive
          ? '1'
          : '0.6';
        break;
    }
  });
}

audio.addEventListener('ended', nextSong);
init();
