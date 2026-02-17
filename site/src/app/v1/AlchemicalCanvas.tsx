"use client";

import { useRef, useEffect, useCallback } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform float u_time;
uniform vec2 u_mouse;
uniform vec2 u_resolution;

out vec4 fragColor;

// Hash functions for pseudo-random noise
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float val = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    val += amp * noise(p);
    p *= 2.0;
    amp *= 0.5;
  }
  return val;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;

  // Grid cell size — controls character density
  float cellSize = 12.0;
  vec2 cell = floor(gl_FragCoord.xy / cellSize);
  vec2 cellUv = fract(gl_FragCoord.xy / cellSize);

  // Animated noise field for character variation
  float t = u_time * 0.15;
  float n = fbm(cell * 0.08 + vec2(t * 0.3, t * 0.2));
  float n2 = fbm(cell * 0.12 + vec2(-t * 0.2, t * 0.15) + 50.0);

  // Mouse heat influence
  vec2 mousePixel = u_mouse * u_resolution;
  float dist = length(gl_FragCoord.xy - mousePixel);
  float heatRadius = 250.0;
  float heat = smoothstep(heatRadius, 0.0, dist);
  heat = heat * heat; // Quadratic falloff for more concentrated effect

  // Radial bloom glow around cursor
  float bloom = smoothstep(heatRadius * 1.3, 0.0, dist) * 0.35;

  // Ripple wave from mouse — increased amplitude
  float ripple = sin(dist * 0.05 - u_time * 3.0) * 0.5 + 0.5;
  ripple *= smoothstep(heatRadius * 1.5, heatRadius * 0.3, dist);

  // Character density: base noise + heat boost
  float density = mix(n, n2, 0.3) * 0.5 + 0.1;
  density += heat * 0.65;
  density += ripple * heat * 0.25;
  density += bloom * 0.2;
  density = clamp(density, 0.0, 1.0);

  // Render pseudo-character shapes using cell UV
  // Create a blocky pattern that mimics ASCII block characters
  vec2 inner = cellUv;

  // Different "character" patterns based on density bands
  float charAlpha;
  if (density < 0.2) {
    // Light scatter — like spaces/dots
    float dot = smoothstep(0.45, 0.4, length(inner - 0.5));
    charAlpha = dot * density * 2.0;
  } else if (density < 0.4) {
    // Light block — like (░)
    float stripe = step(0.5, fract(inner.x * 3.0)) * step(0.5, fract(inner.y * 3.0));
    charAlpha = mix(0.05, 0.2, stripe) * smoothstep(0.1, 0.4, density);
  } else if (density < 0.65) {
    // Medium block — like (▒)
    float checker = step(0.5, fract(inner.x * 2.0 + inner.y * 2.0));
    charAlpha = mix(0.15, 0.35, checker) * smoothstep(0.3, 0.65, density);
  } else {
    // Dense block — like (▓)
    float fill = 1.0 - step(0.85, max(abs(inner.x - 0.5), abs(inner.y - 0.5)) * 2.0);
    charAlpha = mix(0.3, 0.6, fill) * smoothstep(0.5, 1.0, density);
  }

  // Color: charcoal base transitioning to amber near cursor
  vec3 charcoal = vec3(0.18, 0.17, 0.16);
  vec3 amber = vec3(0.83, 0.66, 0.33);    // #d4a855
  vec3 deepAmber = vec3(0.77, 0.58, 0.20); // #c49532

  vec3 brightAmber = vec3(0.91, 0.63, 0.13); // Brighter saturated core
  vec3 baseColor = charcoal;
  vec3 heatColor = mix(deepAmber, amber, ripple);
  // Brighten the core near cursor center
  heatColor = mix(heatColor, brightAmber, heat * heat);
  vec3 color = mix(baseColor, heatColor, heat);

  // Radial bloom additive glow
  color += bloom * vec3(0.91, 0.63, 0.13) * 0.6;

  // Add subtle overall dim glow
  float bgGlow = fbm(uv * 3.0 + t * 0.1) * 0.03;

  // Final color with alpha
  float alpha = charAlpha + bgGlow + bloom * 0.15;
  alpha = clamp(alpha, 0.0, 1.0);

  fragColor = vec4(color * alpha, 1.0);
}
`;

function initWebGL(canvas: HTMLCanvasElement): {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  uniforms: {
    time: WebGLUniformLocation;
    mouse: WebGLUniformLocation;
    resolution: WebGLUniformLocation;
  };
} | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;

  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, VERTEX_SHADER);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    console.error("Vertex shader error:", gl.getShaderInfoLog(vs));
    return null;
  }

  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, FRAGMENT_SHADER);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    console.error("Fragment shader error:", gl.getShaderInfoLog(fs));
    return null;
  }

  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Program link error:", gl.getProgramInfoLog(program));
    return null;
  }

  // Full-screen quad
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );

  const posLoc = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  gl.useProgram(program);

  const timeUniform = gl.getUniformLocation(program, "u_time");
  const mouseUniform = gl.getUniformLocation(program, "u_mouse");
  const resUniform = gl.getUniformLocation(program, "u_resolution");

  if (!timeUniform || !mouseUniform || !resUniform) return null;

  return {
    gl,
    program,
    uniforms: { time: timeUniform, mouse: mouseUniform, resolution: resUniform },
  };
}

export default function AlchemicalCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const smoothMouseRef = useRef({ x: 0.5, y: 0.5 });
  const reducedMotion = useReducedMotion();
  const isMobileRef = useRef(false);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    mouseRef.current = {
      x: e.clientX / window.innerWidth,
      y: 1.0 - e.clientY / window.innerHeight, // Flip Y for GL coords
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Check mobile
    const isMobile = window.innerWidth < 768;
    isMobileRef.current = isMobile;
    if (isMobile) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
    };
    resize();

    const ctx = initWebGL(canvas);
    if (!ctx) return;

    const { gl, uniforms } = ctx;

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("resize", resize);

    let raf: number;
    let startTime = performance.now();
    const frozenTime = 5.0; // Static time value for reduced motion

    const render = () => {
      // Resize viewport if needed
      if (
        gl.canvas.width !== window.innerWidth * dpr ||
        gl.canvas.height !== window.innerHeight * dpr
      ) {
        resize();
      }
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

      // Smooth mouse interpolation
      const lerp = 0.08;
      smoothMouseRef.current.x +=
        (mouseRef.current.x - smoothMouseRef.current.x) * lerp;
      smoothMouseRef.current.y +=
        (mouseRef.current.y - smoothMouseRef.current.y) * lerp;

      const elapsed = reducedMotion
        ? frozenTime
        : (performance.now() - startTime) / 1000;

      gl.uniform1f(uniforms.time, elapsed);
      gl.uniform2f(
        uniforms.mouse,
        smoothMouseRef.current.x,
        smoothMouseRef.current.y
      );
      gl.uniform2f(uniforms.resolution, gl.canvas.width, gl.canvas.height);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      if (!reducedMotion) {
        raf = requestAnimationFrame(render);
      }
    };

    // Render once immediately; only loop if not reduced motion
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", resize);
      // Clean up WebGL resources
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [handleMouseMove, reducedMotion]);

  return (
    <>
      {/* WebGL canvas for desktop */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 -z-10 hidden md:block"
        aria-hidden="true"
      />
      {/* Static ASCII fallback for mobile or no-WebGL */}
      <div
        className="fixed inset-0 -z-10 md:hidden"
        aria-hidden="true"
        style={{ background: "#0d0d0d" }}
      >
        <div className="alchemical-static-ascii" />
      </div>
      <style jsx>{`
        .alchemical-static-ascii {
          position: absolute;
          inset: 0;
          background: #0d0d0d;
          overflow: hidden;
          font-family: monospace;
          font-size: 10px;
          line-height: 1;
          color: rgba(42, 40, 38, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .alchemical-static-ascii::before {
          content: "░░▒░░░▓▒░░░░▒▓░░▒░░░▒░░░░▓▒░░░▒░░▓░░▒░░░░░▒▓░░▒░░░░▒░░▓▒░░░▒░░░░▒▓░░▒░░░▓▒░░░▒░░▓░▒░░░▒░░▒▓░░░░▒░░░▓░░▒░░░▒░░▓▒░░░▒░░░░░▒▓░░▒░░░░▒░░▓▒░░░▒░▓░░▒░░░░░▒▓░░▒░░░░▒░░▓▒░░░▒░░░░▒▓░░▒░░░▓▒░░░▒░░▓░▒░░░▒░░▒▓░░░░▒░░░▓░░▒░░░▒░░▓▒░░░░▒▓░░▒░░░▓▒░░░▒░░▓░▒░░░▒░░▒▓░░░░▒░░░▓░░▒░░░▒░░▓▒░░░▒░░░░▒▓░░▒░░░░▒░░▓▒░░░▒░▓░░▒░░░░░▒▓░░▒░░░░▒░░▓▒░░░▒░░░░▒▓░░▒░░░▓▒░░";
          white-space: pre-wrap;
          word-break: break-all;
          position: absolute;
          inset: 0;
          padding: 20px;
          animation: alchemical-pulse 8s ease-in-out infinite alternate;
        }
        @keyframes alchemical-pulse {
          0% { opacity: 0.3; }
          50% { opacity: 0.5; }
          100% { opacity: 0.35; }
        }
        @media (prefers-reduced-motion: reduce) {
          .alchemical-static-ascii::before {
            animation: none;
            opacity: 0.35;
          }
        }
      `}</style>
    </>
  );
}
