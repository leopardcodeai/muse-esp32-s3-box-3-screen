// pip.js: Float (always on top) and Kiosk (full screen, no cursor, screen awake).
//
// Float opens a Document Picture-in-Picture window and moves the whole stage (canvas
// and picture overlay) into it, so the touch buttons keep working there; the window
// stays above every other app. Where that API is missing (Safari, Firefox before 151)
// the canvas is streamed into a <video> and that goes into the video Picture-in-Picture
// window: always on top too, but a video, so no taps and no pictures of the overlay.
// Kiosk goes full screen, hides the cursor after 3 s and holds a screen wake lock.
//
// Sources: MDN, Document Picture-in-Picture API (Chrome and Edge 116, Firefox 151);
// MDN, Picture-in-Picture API (video; Safari 13.1); MDN, Screen Wake Lock API (Chrome
// 84, Safari 16.4, Firefox 126, secure contexts only). See web/README.md.

// Moves `stage` into a Document Picture-in-Picture window; `onMove(hostWindow)` is called
// when the stage changes windows, `onClose()` when the window is gone. `fonts` are the
// canvas fonts to load in the new document first (a canvas draws with the fonts of the
// document it is in, so without this the first pictures there use a fallback font).
// Returns the window.
export async function floatDocument(stage, { width, height, fonts = [], onMove, onClose }) {
  const pip = await window.documentPictureInPicture.requestWindow({ width, height });
  // A one-time copy of the page's style sheets, the way Chrome's own sample does it.
  for (const sheet of document.styleSheets) {
    try {
      const css = [...sheet.cssRules].map((r) => r.cssText).join("\n");
      const style = pip.document.createElement("style");
      style.textContent = css;
      pip.document.head.appendChild(style);
    } catch {
      const link = pip.document.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      pip.document.head.appendChild(link);
    }
  }
  await Promise.all(fonts.map((f) => pip.document.fonts.load(f).catch(() => null)));
  pip.document.documentElement.classList.add("pip");
  pip.document.body.classList.add("pip-body");
  const placeholder = document.createElement("div");
  placeholder.className = "stage-placeholder";
  stage.parentNode.insertBefore(placeholder, stage);
  pip.document.body.appendChild(stage);
  onMove(pip);
  pip.addEventListener("pagehide", () => {
    placeholder.parentNode.insertBefore(stage, placeholder);
    placeholder.remove();
    onMove(window);
    onClose();
  }, { once: true });
  return pip;
}

export function hasDocumentPip() {
  return typeof window !== "undefined" && "documentPictureInPicture" in window;
}

export function hasVideoPip(video) {
  return !!(document.pictureInPictureEnabled && video.requestPictureInPicture)
    || typeof video.webkitSetPresentationMode === "function";
}

// The fallback: the canvas as a video in the browser's own Picture-in-Picture window.
export async function floatVideo(canvas, video, onClose) {
  if (!video.srcObject) {
    video.srcObject = canvas.captureStream(10);
    video.muted = true;
    video.playsInline = true;
  }
  await video.play();
  if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
    await video.requestPictureInPicture();
    video.addEventListener("leavepictureinpicture", () => onClose(), { once: true });
  } else if (typeof video.webkitSetPresentationMode === "function") {
    video.webkitSetPresentationMode("picture-in-picture");
    const watch = () => {
      if (video.webkitPresentationMode !== "picture-in-picture") {
        video.removeEventListener("webkitpresentationmodechanged", watch);
        onClose();
      }
    };
    video.addEventListener("webkitpresentationmodechanged", watch);
  } else {
    throw new Error("no Picture-in-Picture in this browser");
  }
}

export async function unfloatVideo(video) {
  if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
  else if (typeof video.webkitSetPresentationMode === "function" && video.webkitPresentationMode === "picture-in-picture") {
    video.webkitSetPresentationMode("inline");
  }
}

// Kiosk: full screen, the cursor hidden after 3 s without movement, the screen kept awake.
export class Kiosk {
  constructor(root) {
    this.root = root;
    this.lock = null;
    this.hideTimer = null;
    this.active = false;
    this.onMove = () => this.showCursor();
    this.onVisible = () => {
      if (this.active && document.visibilityState === "visible") this.wake();
    };
  }

  async enter() {
    this.active = true;
    try {
      if (this.root.requestFullscreen) await this.root.requestFullscreen({ navigationUI: "hide" });
      else if (this.root.webkitRequestFullscreen) this.root.webkitRequestFullscreen();
    } catch (e) {
      console.warn("fullscreen refused", e);
    }
    document.documentElement.classList.add("kiosk");
    document.addEventListener("mousemove", this.onMove);
    document.addEventListener("visibilitychange", this.onVisible);
    this.showCursor();
    await this.wake();
  }

  async exit() {
    this.active = false;
    document.documentElement.classList.remove("kiosk", "no-cursor");
    document.removeEventListener("mousemove", this.onMove);
    document.removeEventListener("visibilitychange", this.onVisible);
    clearTimeout(this.hideTimer);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    if (this.lock) {
      await this.lock.release().catch(() => {});
      this.lock = null;
    }
  }

  showCursor() {
    document.documentElement.classList.remove("no-cursor");
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.active) document.documentElement.classList.add("no-cursor");
    }, 3000);
  }

  async wake() {
    if (!("wakeLock" in navigator)) return false;
    try {
      this.lock = await navigator.wakeLock.request("screen");
      this.lock.addEventListener("release", () => { this.lock = null; });
      return true;
    } catch (e) {
      console.warn("wake lock refused", e);
      return false;
    }
  }
}
