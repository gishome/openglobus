goog.provide('og.webgl');

goog.require('og.utils');

og.webgl.vendorPrefixes = ["", "WEBKIT_", "MOZ_"];
og.webgl.MAX_FRAME_DELAY = 24;
if (COMPILED) {
    og.webgl.RESOURCES_URL = "/resources/";
} else {
    og.webgl.RESOURCES_URL = "../../resources/";
}


og.webgl.getExtension = function (gl, name) {
    var i, ext;
    for (i in og.webgl.vendorPrefixes) {
        ext = gl.getExtension(og.webgl.vendorPrefixes[i] + name);
        if (ext) {
            return ext;
        }
    }
    return null;
};

og.webgl.initWebGLContext = function (canvas, params) {
    var ctx;
    try {
        ctx = canvas.getContext("experimental-webgl", params);
        ctx.canvas = canvas;
        canvas.aspect = canvas.width / canvas.height;
    }
    catch (ex) {
        alert("Exception during the GL context initialization");
    }
    if (!ctx) {
        alert("Could not initialise WebGL");
    }
    return ctx;
};

(function () {
    var lastTime = 0;
    og.webgl.requestAnimationFrame = function (callback, element) {
        var currTime = new Date().getTime();
        var timeToCall = Math.max(og.webgl.MAX_FRAME_DELAY, 16 - (currTime - lastTime));
        var id = window.setTimeout(function () { callback(currTime + timeToCall, element); }, timeToCall);
        lastTime = currTime + timeToCall;
        return id;
    };

    og.webgl.cancelAnimationFrame = function (id) {
        clearTimeout(id);
    };
}());

//var start = window.animationTime;
//var rate = 10; // Hz
//var duration = 10; // s
//var lastFrameNumber;
//function animate() {
//    var elapsed = window.animationTime - start;
//    if (elapsed < duration) {
//        window.requestAnimationFrame(animate);
//    }
//    var frameNumber = Math.round(elapsed / (1000 / rate));
//    if (frameNumber == lastFrameNumber)
//        return;
//    lastFrameNumber = frameNumber;
//    // ... update the display based on frameNumber ...
//}
//window.requestAnimationFrame(animate);

