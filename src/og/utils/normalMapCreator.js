goog.provide('og.utils.NormalMapCreator');

goog.require('og.PlanetSegmentHelper');
goog.require('og.shaderProgram.ShaderProgram');
goog.require('og.webgl.Handler');
goog.require('og.webgl.Framebuffer');
goog.require('og.QueueArray');

og.utils.NormalMapCreator = function (handler, width, height, maxFrames) {
    this._handler = handler;
    this._verticesBufferArray = [];
    this._indexBufferArray = [];
    this._positionBuffer = null;
    this._framebuffer = null;
    this._normalMapVerticesTexture = null;

    this._width = width || 128;
    this._height = height || 128;

    this.MAX_FRAMES = maxFrames || 5;
    this._currentFrame = 0;
    this._queue = new og.QueueArray(1024);

    this._lock = new og.idle.Lock();

    this._init();
};

og.utils.NormalMapCreator.prototype._init = function () {

    var isWebkit = false;//('WebkitAppearance' in document.documentElement.style) && !/^((?!chrome).)*safari/i.test(navigator.userAgent);

    /*==================================================================================
     * http://www.sunsetlakesoftware.com/2013/10/21/optimizing-gaussian-blurs-mobile-gpu
     *=================================================================================*/
    var normalMapBlur = new og.shaderProgram.ShaderProgram("normalMapBlur", {
        attributes: {
            a_position: { type: og.shaderProgram.types.VEC2, enableArray: true }
        },
        uniforms: {
            s_texture: { type: og.shaderProgram.types.SAMPLER2D }
        },
        vertexShader: "attribute vec2 a_position; \n\
                       attribute vec2 a_texCoord; \n\
                      \n\
                      varying vec2 blurCoordinates[5]; \n\
                      \n\
                      void main() { \n\
                          vec2 vt = a_position * 0.5 + 0.5;" +
        (isWebkit ? "vt.y = 1.0 - vt.y; " : " ") +
        "gl_Position = vec4(a_position, 0.0, 1.0); \n\
                          blurCoordinates[0] = vt; \n\
                          blurCoordinates[1] = vt + "  + (1.0 / this._width * 1.407333) + ";" +
        "blurCoordinates[2] = vt - " + (1.0 / this._height * 1.407333) + ";" +
        "blurCoordinates[3] = vt + " + (1.0 / this._width * 3.294215) + ";" +
        "blurCoordinates[4] = vt - " + (1.0 / this._height * 3.294215) + ";" +
        "}",
        fragmentShader:
        "precision highp float;\n\
                        uniform sampler2D s_texture; \n\
                        \n\
                        varying vec2 blurCoordinates[5]; \n\
                        \n\
                        void main() { \n\
                            lowp vec4 sum = vec4(0.0); \n\
                            if(blurCoordinates[0].x <= 0.01 || blurCoordinates[0].x >= 0.99 ||\n\
                                blurCoordinates[0].y <= 0.01 || blurCoordinates[0].y >= 0.99){\n\
                                sum = texture2D(s_texture, blurCoordinates[0]);\n\
                            } else {\n\
                                sum += texture2D(s_texture, blurCoordinates[0]) * 0.204164; \n\
                                sum += texture2D(s_texture, blurCoordinates[1]) * 0.304005; \n\
                                sum += texture2D(s_texture, blurCoordinates[2]) * 0.304005; \n\
                                sum += texture2D(s_texture, blurCoordinates[3]) * 0.093913; \n\
                                sum += texture2D(s_texture, blurCoordinates[4]) * 0.093913; \n\
                            }\n\
                            gl_FragColor = sum; \n\
                        }"
    });

    var normalMap = new og.shaderProgram.ShaderProgram("normalMap", {
        attributes: {
            a_position: { type: og.shaderProgram.types.VEC2, enableArray: true },
            a_normal: { type: og.shaderProgram.types.VEC3, enableArray: true }
        },
        vertexShader: "attribute vec2 a_position; \
                      attribute vec3 a_normal; \
                      \
                      varying vec3 v_color; \
                      \
                      void main() { \
                          gl_PointSize = 1.0; \
                          gl_Position = vec4(a_position, 0, 1); \
                          v_color = normalize(a_normal) * 0.5 + 0.5; \
                      }",
        fragmentShader:
        "precision highp float;\n\
                        \
                        varying vec3 v_color; \
                        \
                        void main () { \
                            gl_FragColor = vec4(v_color, 1.0); \
                        }"
    });

    this._handler.addShaderProgram(normalMapBlur);
    this._handler.addShaderProgram(normalMap);

    //create hidden handler buffer
    this._framebuffer = new og.webgl.Framebuffer(this._handler, {
        width: this._width,
        height: this._height,
        useDepth: false
    });

    this._normalMapVerticesTexture = this._handler.createEmptyTexture_l(this._width, this._height);

    //create vertices hasharray for different grid size segments
    for (var p = 1; p <= 6; p++) {
        var gs = Math.pow(2, p);
        var gs2 = (gs / 2);
        var vertices = [];

        for (var i = 0; i <= gs; i++) {
            for (var j = 0; j <= gs; j++) {
                vertices.push(-1 + j / gs2, -1 + i / gs2);
            }
        }

        this._verticesBufferArray[gs] = this._handler.createArrayBuffer(new Float32Array(vertices), 2, vertices.length / 2);
        var indexes = og.PlanetSegmentHelper.createSegmentIndexes(gs, [gs, gs, gs, gs]);
        this._indexBufferArray[gs] = this._handler.createElementArrayBuffer(indexes, 1, indexes.length);
    }

    //create 2d screen square buffer
    var positions = new Float32Array([
        -1.0, -1.0,
        1.0, -1.0,
        -1.0, 1.0,
        1.0, 1.0]);

    this._positionBuffer = this._handler.createArrayBuffer(positions, 2, positions.length / 2);
};

og.utils.NormalMapCreator.prototype._drawNormalMap = function (segment) {
    var normals = segment.normalMapNormals;
    if (segment.node && segment.node.getState() !== og.quadTree.NOTRENDERING
        && normals && normals.length) {

        segment._normalMapEdgeEqualize(og.quadTree.N, 0);
        segment._normalMapEdgeEqualize(og.quadTree.S, 1);
        segment._normalMapEdgeEqualize(og.quadTree.W, 0, true);
        segment._normalMapEdgeEqualize(og.quadTree.E, 1, true);

        var outTexture = segment.normalMapTexturePtr;
        var size = normals.length / 3;
        var gridSize = Math.sqrt(size) - 1;

        var h = this._handler;
        var gl = h.gl;

        var _normalsBuffer = h.createArrayBuffer(normals, 3, size, gl.DYNAMIC_DRAW);

        var f = this._framebuffer;
        var p = h.shaderPrograms.normalMap;
        var sha = p._program.attributes;

        f.bindOutputTexture(this._normalMapVerticesTexture);

        p.activate();

        gl.bindBuffer(gl.ARRAY_BUFFER, this._verticesBufferArray[gridSize]);
        gl.vertexAttribPointer(sha.a_position._pName, this._verticesBufferArray[gridSize].itemSize, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, _normalsBuffer);
        gl.vertexAttribPointer(sha.a_normal._pName, _normalsBuffer.itemSize, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._indexBufferArray[gridSize]);
        gl.drawElements(gl.TRIANGLE_STRIP, this._indexBufferArray[gridSize].numItems, gl.UNSIGNED_SHORT, 0);

        gl.deleteBuffer(_normalsBuffer);

        //
        // blur pass
        //
        f.bindOutputTexture(outTexture);

        p = h.shaderPrograms.normalMapBlur;

        p.activate();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._positionBuffer);
        gl.vertexAttribPointer(p._program.attributes.a_position._pName, this._positionBuffer.itemSize, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._normalMapVerticesTexture);
        gl.uniform1i(p._program.uniforms.s_texture._pName, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, this._positionBuffer.numItems);
        return true;
    }
    return false;
};

og.utils.NormalMapCreator.prototype.frame = function () {

    if (this._queue.length) {
        var h = this._handler,
            gl = h.gl;

        this._framebuffer.activate();

        gl.disable(gl.CULL_FACE);
        gl.disable(gl.DEPTH_TEST);

        var deltaTime = 0,
            startTime = window.performance.now();

        var width = this._width,
            height = this._height;

        while (this._lock.isFree() && this._queue.length && deltaTime < 0.25) {
            var segment = this._queue.shift();
            if (segment.terrainReady && this._drawNormalMap(segment)) {
                segment.normalMapReady = true;
                segment.normalMapTexture = segment.normalMapTexturePtr;
                segment.normalMapTextureBias[0] = 0;
                segment.normalMapTextureBias[1] = 0;
                segment.normalMapTextureBias[2] = 1;
            }
            segment._inTheQueue = false;
            deltaTime = window.performance.now() - startTime;
        }

        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);

        this._framebuffer.deactivate();
    }
};

og.utils.NormalMapCreator.prototype.queue = function (segment) {
    segment._inTheQueue = true;
    this._queue.push(segment);
};

og.utils.NormalMapCreator.prototype.unshift = function (segment) {
    segment._inTheQueue = true;
    this._queue.unshift(segment);
};

og.utils.NormalMapCreator.prototype.remove = function (segment) {
    //...
};

og.utils.NormalMapCreator.prototype.clear = function () {
    while (this._queue.length) {
        var s = this._queue.pop();
        s._inTheQueue = false;
    }
};

/**
 * Set activity off
 * @public
 */
og.utils.NormalMapCreator.prototype.lock = function (key) {
    this._lock.lock(key);
};

/**
 * Set activity on
 * @public
 */
og.utils.NormalMapCreator.prototype.free = function (key) {
    this._lock.free(key);
};