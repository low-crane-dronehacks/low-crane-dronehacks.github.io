// Lightweight custom video player: autoplays muted while in view (unless the
// viewer prefers reduced motion), with a minimal glass control bar. Without JS
// the native controls remain.
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const icon = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  pause:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
  muted:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  sound:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>',
  full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const fmt = (t: number) => {
  if (!Number.isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

function button(cls: string, label: string, html: string) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.setAttribute("aria-label", label);
  b.innerHTML = html;
  return b;
}

function enhance(fig: HTMLElement) {
  const video = fig.querySelector("video");
  if (!video) return;
  video.controls = false;
  video.muted = true;
  fig.classList.add("is-enhanced");

  const big = button("player-big", "Play video", icon.play);
  const bar = document.createElement("div");
  bar.className = "player-bar";
  const play = button("player-btn", "Play", icon.play);
  const track = document.createElement("div");
  track.className = "player-track";
  track.setAttribute("role", "slider");
  track.setAttribute("aria-label", "Seek");
  track.tabIndex = 0;
  const fill = document.createElement("div");
  fill.className = "player-fill";
  track.append(fill);
  const time = document.createElement("span");
  time.className = "player-time";
  time.textContent = "0:00";
  const mute = button("player-btn", "Unmute", icon.muted);
  const full = button("player-btn", "Full screen", icon.full);
  bar.append(play, track, time, mute, full);
  fig.append(big, bar);

  const sync = () => {
    const paused = video.paused;
    fig.classList.toggle("is-paused", paused);
    play.innerHTML = paused ? icon.play : icon.pause;
    play.setAttribute("aria-label", paused ? "Play" : "Pause");
    mute.innerHTML = video.muted ? icon.muted : icon.sound;
    mute.setAttribute("aria-label", video.muted ? "Unmute" : "Mute");
  };
  const tick = () => {
    const p = video.duration ? video.currentTime / video.duration : 0;
    fill.style.transform = `scaleX(${p})`;
    track.setAttribute("aria-valuenow", String(Math.round(p * 100)));
    time.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
  };
  const toggle = () => (video.paused ? video.play() : video.pause());

  big.addEventListener("click", toggle);
  play.addEventListener("click", toggle);
  video.addEventListener("click", toggle);
  mute.addEventListener("click", () => {
    video.muted = !video.muted;
    sync();
  });
  full.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else fig.requestFullscreen?.() ?? video.requestFullscreen?.();
  });
  const seek = (clientX: number) => {
    const r = track.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    if (video.duration) video.currentTime = f * video.duration;
  };
  track.addEventListener("pointerdown", e => {
    seek(e.clientX);
    track.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => seek(ev.clientX);
    track.addEventListener("pointermove", move);
    track.addEventListener(
      "pointerup",
      () => track.removeEventListener("pointermove", move),
      { once: true }
    );
  });
  track.addEventListener("keydown", e => {
    if (e.key === "ArrowRight") video.currentTime += 2;
    if (e.key === "ArrowLeft") video.currentTime -= 2;
  });
  ["play", "pause", "volumechange"].forEach(ev =>
    video.addEventListener(ev, sync)
  );
  ["timeupdate", "loadedmetadata", "seeked"].forEach(ev =>
    video.addEventListener(ev, tick)
  );
  sync();

  if (!reduceMotion && "IntersectionObserver" in window) {
    new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !fig.dataset.userPaused)
          video.play().catch(() => {});
        else if (!entry.isIntersecting) video.pause();
      },
      { threshold: 0.4 }
    ).observe(fig);
    // a pause the viewer chose sticks; scrolling back does not restart it
    [big, play, video].forEach(el =>
      el.addEventListener("click", () => {
        if (video.paused) fig.dataset.userPaused = "1";
        else delete fig.dataset.userPaused;
      })
    );
  }
}

document.querySelectorAll<HTMLElement>(".player").forEach(enhance);

async function mountRerun(el: HTMLElement) {
  const rrd = el.dataset.rrd;
  if (!rrd) return;
  const rbl = el.dataset.rbl;
  const urls = [
    ...(rbl ? [new URL(rbl, window.location.href).href] : []),
    new URL(rrd, window.location.href).href,
  ];
  const { WebViewer } = await import("@rerun-io/web-viewer");
  const viewer = new WebViewer();
  const theme =
    document.documentElement.dataset.theme === "light" ? "light" : "dark";
  await viewer.start(urls, el, {
    width: "100%",
    height: "100%",
    hideWelcomeScreen: true,
    allowFullscreen: true,
    theme,
  });
}

document.querySelectorAll<HTMLElement>(".rerun-player").forEach(el => {
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        mountRerun(el).catch(() => {});
      },
      { rootMargin: "300px" }
    );
    io.observe(el);
  } else {
    mountRerun(el).catch(() => {});
  }
});
