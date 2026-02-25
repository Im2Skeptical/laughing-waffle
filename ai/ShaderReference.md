<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mucha Art Nouveau Shader</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <style>
        body { margin: 0; overflow: hidden; background-color: #1a1a1a; color: #e5e5e5; font-family: sans-serif; }
        #canvas-container { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 1; }
        #ui-panel { position: absolute; top: 20px; right: 20px; z-index: 10; width: 320px; background: rgba(20, 20, 22, 0.85); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        .slider-row { margin-bottom: 15px; }
        .slider-row label { display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.05em; color: #aaa; }
        input[type=range] { width: 100%; accent-color: #d4af37; }
        button { background: #d4af37; color: #111; border: none; padding: 10px; width: 100%; border-radius: 6px; font-weight: bold; cursor: pointer; transition: background 0.2s; text-transform: uppercase; letter-spacing: 1px; margin-top: 10px; }
        button:hover { background: #e8c655; }
        #hidden-canvas { display: none; }
    </style>
</head>
<body>

    <div id="canvas-container"></div>
    
    <!-- Hidden canvas used to generate the "Flat Color" base art -->
    <canvas id="hidden-canvas" width="1024" height="1024"></canvas>

    <div id="ui-panel">
        <h1 class="text-xl font-bold mb-4 text-[#d4af37] border-b border-gray-700 pb-2">Mucha Shader Lab</h1>
        <p class="text-xs text-gray-400 mb-6 leading-relaxed">Converts flat geometric inputs into textured, lithographic Art Deco/Nouveau style illustrations.</p>

        <div class="slider-row">
            <label><span>Ink Line Thickness</span> <span id="val-lines">1.5</span></label>
            <input type="range" id="lineThickness" min="0.0" max="4.0" step="0.1" value="1.5">
        </div>
        <div class="slider-row">
            <label><span>Organic Wobble</span> <span id="val-wobble">0.8</span></label>
            <input type="range" id="lineWobble" min="0.0" max="2.0" step="0.1" value="0.8">
        </div>
        <div class="slider-row">
            <label><span>Paint Mottling</span> <span id="val-mottle">0.6</span></label>
            <input type="range" id="mottling" min="0.0" max="1.5" step="0.05" value="0.6">
        </div>
        <div class="slider-row">
            <label><span>Litho Misregister</span> <span id="val-bleed">0.4</span></label>
            <input type="range" id="colorBleed" min="0.0" max="1.0" step="0.05" value="0.4">
        </div>
        <div class="slider-row">
            <label><span>Vintage Age/Warmth</span> <span id="val-age">0.7</span></label>
            <input type="range" id="vintageAge" min="0.0" max="1.0" step="0.05" value="0.7">
        </div>

        <button id="btn-generate">Regenerate Base Art</button>
    </div>

    <script>
        // --- 1. BASE ART GENERATION (The Flat Colors) ---
        // We draw flat Art Nouveau-inspired shapes onto a hidden 2D canvas.
        // This simulates an artist providing flat colors before the shader pass.
        const ctx2d = document.getElementById('hidden-canvas').getContext('2d');
        const palettes = [
            ['#2A363B', '#E84A5F', '#FF847C', '#FECEAB', '#99B898'], // Muted modern
            ['#3A4033', '#7A8C77', '#EEDBA5', '#D98A6C', '#8C3E3E'], // Classic Mucha earthy
            ['#1E2C3A', '#456990', '#F45B69', '#FFEAB0', '#55A38B'], // Bold Deco
        ];

        function drawBaseArt() {
            const width = ctx2d.canvas.width;
            const height = ctx2d.canvas.height;
            const palette = palettes[Math.floor(Math.random() * palettes.length)];
            
            // Base background (parchment/paper color)
            ctx2d.fillStyle = '#f4eedd';
            ctx2d.fillRect(0, 0, width, height);

            // Draw a decorative background arch
            ctx2d.fillStyle = palette[2];
            ctx2d.beginPath();
            ctx2d.arc(width/2, height/2 + 100, 350, Math.PI, 0);
            ctx2d.fill();

            // Draw a halo / central circle
            ctx2d.fillStyle = palette[3];
            ctx2d.beginPath();
            ctx2d.arc(width/2, height/2 - 50, 200, 0, Math.PI * 2);
            ctx2d.fill();

            // Draw organic flowing shapes (representing hair or fabric)
            ctx2d.fillStyle = palette[4];
            ctx2d.beginPath();
            ctx2d.moveTo(width/2, height/2 - 250);
            ctx2d.bezierCurveTo(width/2 + 200, height/2 - 200, width/2 + 300, height/2 + 200, width/2 + 100, height + 100);
            ctx2d.bezierCurveTo(width/2 + 50, height, width/2 - 50, height, width/2 - 100, height + 100);
            ctx2d.bezierCurveTo(width/2 - 300, height/2 + 200, width/2 - 200, height/2 - 200, width/2, height/2 - 250);
            ctx2d.fill();

            // Draw foreground shapes (floral motifs / geometric deco)
            for(let i=0; i<15; i++) {
                ctx2d.fillStyle = palette[Math.floor(Math.random() * 2)]; // Darker elements
                ctx2d.beginPath();
                const x = width/2 + (Math.random() - 0.5) * 600;
                const y = height/2 + (Math.random() - 0.5) * 600 + 200;
                const r = 20 + Math.random() * 60;
                
                // Draw a petal/leaf shape
                ctx2d.moveTo(x, y - r);
                ctx2d.quadraticCurveTo(x + r, y, x, y + r);
                ctx2d.quadraticCurveTo(x - r, y, x, y - r);
                ctx2d.fill();
            }

            // Draw a central focal shape (e.g. silhouette profile)
            ctx2d.fillStyle = palette[0]; // Darkest
            ctx2d.beginPath();
            ctx2d.moveTo(width/2 - 60, height);
            ctx2d.lineTo(width/2 - 60, height/2 + 50);
            ctx2d.bezierCurveTo(width/2 - 60, height/2 - 50, width/2 + 80, height/2 - 50, width/2 + 80, height/2 + 50);
            ctx2d.lineTo(width/2 + 80, height);
            ctx2d.fill();
        }

        // --- 2. WEBGL SHADER SETUP (THREE.JS) ---
        const container = document.getElementById('canvas-container');
        const renderer = new THREE.WebGLRenderer({ antialias: false });
        renderer.setSize(window.innerWidth, window.innerHeight);
        container.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        // Create texture from the hidden canvas
        drawBaseArt();
        const baseTexture = new THREE.CanvasTexture(document.getElementById('hidden-canvas'));
        baseTexture.minFilter = THREE.LinearFilter;
        baseTexture.magFilter = THREE.LinearFilter;

        // The Mucha Post-Processing Shader
        const muchaShader = {
            uniforms: {
                "tDiffuse": { value: baseTexture },
                "u_resolution": { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
                "u_lineThickness": { value: 1.5 },
                "u_lineWobble": { value: 0.8 },
                "u_mottling": { value: 0.6 },
                "u_colorBleed": { value: 0.4 },
                "u_vintageAge": { value: 0.7 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform vec2 u_resolution;
                uniform float u_lineThickness;
                uniform float u_lineWobble;
                uniform float u_mottling;
                uniform float u_colorBleed;
                uniform float u_vintageAge;
                
                varying vec2 vUv;

                // --- NOISE FUNCTIONS ---
                float hash(vec2 p) {
                    p = fract(p * vec2(123.34, 456.21));
                    p += dot(p, p + 45.32);
                    return fract(p.x * p.y);
                }

                float noise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    vec2 u = f * f * (3.0 - 2.0 * f);
                    return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
                               mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
                }

                float fbm(vec2 p) {
                    float v = 0.0;
                    float a = 0.5;
                    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
                    for (int i = 0; i < 5; ++i) {
                        v += a * noise(p);
                        p = rot * p * 2.0 + vec2(100.0);
                        a *= 0.5;
                    }
                    return v;
                }

                void main() {
                    vec2 uv = vUv;
                    vec2 texel = 1.0 / u_resolution;

                    // 1. LITHOGRAPHIC MISREGISTRATION (Color Bleed)
                    // We offset the UVs slightly differently for R, G, and B based on noise
                    float bleedNoise = fbm(uv * 10.0) * 2.0 - 1.0;
                    vec2 rOffset = texel * bleedNoise * 5.0 * u_colorBleed;
                    vec2 gOffset = texel * bleedNoise * -3.0 * u_colorBleed;
                    vec2 bOffset = texel * bleedNoise * 2.0 * u_colorBleed;

                    float r = texture2D(tDiffuse, uv + rOffset).r;
                    float g = texture2D(tDiffuse, uv + gOffset).g;
                    float b = texture2D(tDiffuse, uv + bOffset).b;
                    vec3 baseColor = vec3(r, g, b);

                    // 2. ORGANIC EDGE DETECTION (Sobel Filter with Noise Wobble)
                    // Add high-frequency noise to the sampling distance to make lines look hand-drawn
                    float wobble = noise(uv * 500.0) * u_lineWobble;
                    float actualThickness = u_lineThickness * (1.0 + wobble);
                    vec2 offset = texel * actualThickness;

                    vec3 n  = texture2D(tDiffuse, uv + vec2(0.0, offset.y)).rgb;
                    vec3 s  = texture2D(tDiffuse, uv + vec2(0.0, -offset.y)).rgb;
                    vec3 e  = texture2D(tDiffuse, uv + vec2(offset.x, 0.0)).rgb;
                    vec3 w  = texture2D(tDiffuse, uv + vec2(-offset.x, 0.0)).rgb;
                    vec3 ne = texture2D(tDiffuse, uv + vec2(offset.x, offset.y)).rgb;
                    vec3 nw = texture2D(tDiffuse, uv + vec2(-offset.x, offset.y)).rgb;
                    vec3 se = texture2D(tDiffuse, uv + vec2(offset.x, -offset.y)).rgb;
                    vec3 sw = texture2D(tDiffuse, uv + vec2(-offset.x, -offset.y)).rgb;

                    // Compute gradient magnitude per color channel to detect color borders
                    vec3 gx = -nw - 2.0*w - sw + ne + 2.0*e + se;
                    vec3 gy = -nw - 2.0*n - ne + sw + 2.0*s + se;
                    float edgeStrength = length(gx) + length(gy);
                    
                    // Threshold and smooth the edge to make distinct ink lines
                    float edge = smoothstep(0.2, 0.8, edgeStrength);

                    // 3. PAINT MOTTLING (Gouache/Watercolor unevenness)
                    float mottleNoise = fbm(uv * 3.0);
                    // Lighten or darken base color slightly based on noise
                    baseColor *= 1.0 + (mottleNoise - 0.5) * u_mottling;

                    // 4. VINTAGE GRADING & PAPER
                    // Desaturate slightly
                    float luminance = dot(baseColor, vec3(0.299, 0.587, 0.114));
                    vec3 desaturated = mix(baseColor, vec3(luminance), 0.3 * u_vintageAge);
                    
                    // Tint towards warm paper (bone/ochre)
                    vec3 paperTint = vec3(1.05, 0.98, 0.85);
                    vec3 finalColor = desaturated * mix(vec3(1.0), paperTint, u_vintageAge);

                    // Add high frequency paper grain
                    float grain = hash(uv * u_resolution) * 0.08 * u_vintageAge;
                    finalColor -= grain;

                    // 5. COMPOSITING
                    // Blend the dark brown/sepia ink lines over the colored image
                    vec3 inkColor = mix(vec3(0.1, 0.05, 0.02), vec3(0.2, 0.15, 0.1), wobble); // slight color variation in ink
                    finalColor = mix(finalColor, inkColor, edge * 0.9);

                    // Vignette
                    float dist = distance(uv, vec2(0.5));
                    finalColor *= smoothstep(0.85, 0.3, dist * (1.0 + u_vintageAge * 0.2));

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `
        };

        const material = new THREE.ShaderMaterial(muchaShader);
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
        scene.add(quad);

        // --- 3. UI CONTROLS & ANIMATION LOOP ---
        const inputs = {
            lineThickness: document.getElementById('lineThickness'),
            lineWobble: document.getElementById('lineWobble'),
            mottling: document.getElementById('mottling'),
            colorBleed: document.getElementById('colorBleed'),
            vintageAge: document.getElementById('vintageAge')
        };

        // Update uniforms on slider move
        for (let key in inputs) {
            inputs[key].addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                muchaShader.uniforms[`u_${key}`].value = val;
                
                // Update text label mappings
                let labelId = key === 'lineThickness' ? 'val-lines' :
                              key === 'lineWobble' ? 'val-wobble' :
                              key === 'mottling' ? 'val-mottle' :
                              key === 'colorBleed' ? 'val-bleed' : 'val-age';
                document.getElementById(labelId).innerText = val.toFixed(2);
            });
        }

        // Regenerate base art
        document.getElementById('btn-generate').addEventListener('click', () => {
            drawBaseArt();
            baseTexture.needsUpdate = true;
        });

        // Handle resize
        window.addEventListener('resize', () => {
            renderer.setSize(window.innerWidth, window.innerHeight);
            muchaShader.uniforms.u_resolution.value.set(window.innerWidth, window.innerHeight);
        });

        function animate() {
            requestAnimationFrame(animate);
            renderer.render(scene, camera);
        }
        
        animate();
    </script>
</body>
</html>