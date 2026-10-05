// Execute the shipped GLSL on WebGL: flat-water neutrality, shoreline bending,
// reflected propagation, weather freezing, hull heading and finite swamp heights.
// --break-refraction must fail the shoreline bend assertion.
import assert from 'node:assert/strict';
import { readSrc, grabConst } from './audit_src.mjs';
import { chromiumOrNull, skipNoPlaywright } from './pw.mjs';

const src = readSrc('public', 'js', 'toon.js');
const WIND = new Function(`${grabConst(src, 'WIND')}\nreturn WIND;`)();
if (process.argv.includes('--break-refraction')) WIND.SEA_REFRACT_F = 0;
const seaSegM = () => WIND.SEA_M / WIND.SEA_SEG;
const glsl = name => {
  const match = new RegExp(`const ${name} = (\x60[\\s\\S]*?\x60);`).exec(src);
  assert.ok(match, `Missing shipped shader ${name}`);
  return new Function('WIND', 'seaSegM', `return ${match[1]};`)(WIND, seaSegM);
};
const shader = `${glsl('CEL_WIND_GLSL')}\n${glsl('CEL_SWAMP_RIPPLE_GLSL')}\n${glsl('CEL_SEA_GLSL')}`;
const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('audit_wavefronts.mjs');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(({ shader, sourceCount }) => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('Float WebGL2 targets unavailable');
    const compile = (type, source) => {
      const object = gl.createShader(type);
      gl.shaderSource(object, source); gl.compileShader(object);
      if (!gl.getShaderParameter(object, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(object));
      return object;
    };
    const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
      void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`);
    const build = swamp => {
      const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float;
        #define texture2D texture
        ${swamp ? '#define CEL_SWAMP_RIPPLE' : ''}
        uniform sampler2D uSeaField; uniform vec4 uSeaRect;
        uniform vec2 probePosition; uniform vec2 probeDirection; uniform vec4 probeField;
        uniform int probeMode; out vec4 result;
        ${shader}
        void main() { result = probeMode == 0
          ? vec4(celSeaPhases(probePosition, probeDirection, probeField, 1.0), 1.0)
          : vec4(celSeaH(probePosition), 0.0, 0.0, 1.0); }`);
      const program = gl.createProgram();
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      return program;
    };
    const sea = build(false), swamp = build(true);
    const target = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null);
    const framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete float framebuffer');
    const field = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, field);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255,255,128,128]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.viewport(0, 0, 1, 1);
    const sample = (p, depth = 32, slope = 0, dir = [-1, 0], mode = 0, hull = null, frozen = false, program = sea) => {
      gl.useProgram(program);
      const loc = name => gl.getUniformLocation(program, name);
      gl.uniform2fv(loc('probePosition'), p); gl.uniform2fv(loc('probeDirection'), dir);
      gl.uniform4fv(loc('probeField'), [1, depth / 32, (128 + slope * 127) / 255, 128 / 255]);
      gl.uniform1i(loc('probeMode'), mode); gl.uniform1i(loc('uSeaField'), 0);
      gl.uniform4fv(loc('uSeaRect'), [-100,-100,.005,.005]);
      gl.uniform2fv(loc('uWindDir'), [-.5,.8660254]); gl.uniform2fv(loc('uGustK'), [.01,.02]);
      gl.uniform1f(loc('uSoftAmp'), .9); gl.uniform1f(loc('uSoftFreq'), .55);
      gl.uniform1f(loc('uWeatherWaveAmp'), frozen ? 0 : 1);
      gl.uniform1f(loc('uWeatherWaveT'), 2.5); gl.uniform1f(loc('uWindT'), 2.5);
      gl.uniform4fv(loc('uWeatherWindShape'), [.2,.1,.4,1]);
      gl.uniform4fv(loc('uWeatherWaterShape'), [.3,.2,.6,0]);
      const positions = new Float32Array(sourceCount * 4), shapes = new Float32Array(sourceCount * 4);
      if (hull) { positions.set([0,0,...hull]); shapes.set([20,6,4,1]); }
      gl.uniform4fv(loc('uSeaSources[0]'), positions); gl.uniform4fv(loc('uSeaSourceShape[0]'), shapes);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const pixel = new Float32Array(4); gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,pixel);
      if (gl.getError() !== gl.NO_ERROR || !pixel.every(Number.isFinite)) throw new Error('Non-finite wave sample or WebGL error');
      return Array.from(pixel);
    };
    const dir = [-Math.SQRT1_2, Math.SQRT1_2], e = .1;
    const left = sample([-e,0],6-e*.2,.2,dir), right = sample([e,0],6+e*.2,.2,dir);
    const bottom = sample([0,-e],6,.2,dir), top = sample([0,e],6,.2,dir);
    const dx = (right[0] - left[0]) / (2*e), dz = (top[0] - bottom[0]) / (2*e);
    const inbound = sample([0,0],2,.3), outbound = sample([0,0],2,.3,[1,0]);
    const refLeft = sample([-e,0],2-e*.3,.3), refRight = sample([e,0],2+e*.3,.3);
    const northP = [10.2,-30], eastP = [-30,-10.2];
    const north = sample(northP,32,0,dir,1,[0,1])[0] - sample(northP,32,0,dir,1)[0];
    const east = sample(eastP,32,0,dir,1,[1,0])[0] - sample(eastP,32,0,dir,1)[0];
    const ahead = [10.2,30];
    const aheadDelta = sample(ahead,32,0,dir,1,[0,1])[0] - sample(ahead,32,0,dir,1)[0];
    const flat = sample([10,5],32,0), shallowFlat = sample([10,5],2,0);
    return { dx, dz, inbound, outbound, reflectedDx: (refRight[1]-refLeft[1])/(2*e),
      flat, shallowFlat, north, east, aheadDelta,
      frozen: sample(northP,32,0,dir,1,[0,1],true)[0],
      swamp: sample([6,12],32,0,dir,1,null,false,swamp)[0] };
  }, { shader, sourceCount: WIND.SEA_SOURCE_N });
  assert.ok(Math.abs(result.dx) > Math.abs(result.dz) * 1.02, 'Shallow fronts must bend toward the shoreline normal');
  assert.ok(result.inbound[2] > 0 && result.outbound[2] === 0, 'Only incoming waves create reflected energy');
  assert.ok(result.reflectedDx > 0, 'Reflected fronts must travel away from an X shoreline');
  assert.deepEqual(result.flat, result.shallowFlat, 'Flat depth without a gradient must not rotate a front');
  assert.ok(Math.abs(result.north) > .005 && Math.abs(result.north-result.east) < 1e-5, 'Hull wakes must rotate with heading');
  assert.equal(result.aheadDelta, 0, 'A stern wake must not appear ahead of its hull');
  assert.equal(result.frozen, 0, 'Frozen weather must suppress every height contribution');
  assert.ok(Number.isFinite(result.swamp), 'Swamp shaders must compile and return finite heights');
  console.log('PASS: 8 WebGL wavefront checks; sea and swamp GLSL compile');
} finally {
  await browser.close();
}
