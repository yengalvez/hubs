/*
HACK: Our fork of aframe will read this global in src/utils/device.js to force the WebVR codepaths.
*/
window.forceWebVR = true;

/*
HACK Fix a-frame's device detection in Chrome when WebXR or WebVR flags are enabled in
chrome://flags. See https://github.com/mozilla/hubs/issues/892
*/
if (!/mobile vr/i.test(navigator.userAgent) && navigator.xr && !navigator.xr.requestDevice) {
  navigator.xr.requestDevice = () => Promise.reject({ message: "Hubs: requestDevice not supported." });
}
/*
HACK Call getVRDisplays to force Oculus Browser to use WebVR, which in turn disables the WebXR API.
*/
if (/Oculus/.test(navigator.userAgent)) {
  navigator.getVRDisplays();
}
