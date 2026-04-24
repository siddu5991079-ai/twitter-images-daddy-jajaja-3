const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { execSync } = require('child_process');
const fs = require('fs');

// ==========================================
// ⚙️ SETTINGS & ENVIRONMENT VARIABLES
// ==========================================
const TARGET_URL = process.env.TARGET_URL || 'https://dlstreams.com/watch.php?id=316';
const WAIT_TIME_MS = 120 * 1000; // 2 Minutes wait time

let cycleCounter = 1;

async function generateAndUploadThumbnail() {
    console.log(`\n--------------------------------------------------`);
    console.log(`--- 🔄 STARTING THUMBNAIL CYCLE #${cycleCounter} ---`);
    console.log(`--------------------------------------------------`);
    
    const browser = await puppeteer.launch({
        channel: 'chrome', 
        headless: false, 
        defaultViewport: { width: 1280, height: 720 },
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--autoplay-policy=no-user-gesture-required', 
            '--mute-audio'
        ]
    });

    const page = await browser.newPage();
    console.log(`[*] Navigating to target URL: ${TARGET_URL}...`);
    
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 10000)); // Wait for player to load

    let targetFrame = null;

    console.log('[*] Scanning iframes for the Live Stream Video...');
    for (const frame of page.frames()) {
        try {
            const isRealLiveStream = await frame.evaluate(() => {
                const vid = document.querySelector('video[data-html5-video]') || document.querySelector('video');
                return vid && vid.clientWidth > 300; 
            });
            if (isRealLiveStream) {
                targetFrame = frame;
                // Remove floating ads inside iframe if any
                await frame.evaluate(() => { const fAd = document.getElementById('floated'); if (fAd) fAd.remove(); });
                break;
            }
        } catch (e) { }
    }

    if (!targetFrame) {
        console.log('[❌] No video frame found. Skipping this cycle...');
        await browser.close();
        return;
    }

    // ==========================================
    // 🛠️ CLICK, PLAY & FULLSCREEN LOGIC
    // ==========================================
    console.log('[*] Attempting to click, play, and fullscreen the video...');
    
    // 1. Center click to interact
    try {
        const iframeEl = await targetFrame.frameElement();
        const box = await iframeEl.boundingBox();
        if (box) await page.mouse.click(box.x + (box.width / 2), box.y + (box.height / 2), { delay: 100 });
        await new Promise(r => setTimeout(r, 2000));
    } catch (e) { }

    // 2. Force Play
    await targetFrame.evaluate(async () => {
        const video = document.querySelector('video[data-html5-video]') || document.querySelector('video');
        if (video) { video.volume = 1.0; await video.play().catch(e => {}); }
    });

    // 3. Force Fullscreen
    await targetFrame.evaluate(async () => {
        const vid = document.querySelector('video[data-html5-video]') || document.querySelector('video');
        if (!vid) return;
        try {
            if (vid.requestFullscreen) await vid.requestFullscreen();
            else if (vid.webkitRequestFullscreen) await vid.webkitRequestFullscreen();
        } catch (err) {
            // CSS Fallback
            vid.style.position = 'fixed'; vid.style.top = '0'; vid.style.left = '0';
            vid.style.width = '100vw'; vid.style.height = '100vh'; vid.style.zIndex = '2147483647'; 
            vid.style.backgroundColor = 'black'; vid.style.objectFit = 'contain';
        }
    });

    // 👇 NAYA UPDATE: Wait for 5 seconds taake video properly play ho jaye 👇
    console.log('[⏳] Waiting 5 seconds to ensure video is fully playing...');
    await new Promise(r => setTimeout(r, 5000)); 

    // ==========================================
    // 🛑 STRICT VERIFICATION CHECK (PLAYING + FULLSCREEN)
    // ==========================================
    const videoStatus = await targetFrame.evaluate(() => {
        const vid = document.querySelector('video[data-html5-video]') || document.querySelector('video');
        if (!vid) return { isFullscreen: false, isPlaying: false };
        
        // Check Fullscreen
        const isNativeFS = document.fullscreenElement !== null || document.webkitFullscreenElement !== null;
        const isCssFS = vid.style.width === '100vw';
        const isLargeEnough = vid.clientWidth >= window.innerWidth * 0.8; // At least 80% of screen
        
        // Check if Video is actually Playing (not paused, and has data loaded)
        // readyState >= 2 means current data is available to play
        const isPlaying = !vid.paused && !vid.ended && vid.readyState >= 2;

        return { 
            isFullscreen: isNativeFS || isCssFS || isLargeEnough,
            isPlaying: isPlaying
        };
    });

    // 👇 NAYA UPDATE: Agar play nahi ho rahi ya fullscreen nahi hai, toh skip karo 👇
    if (!videoStatus.isFullscreen || !videoStatus.isPlaying) {
        console.log(`[⚠️] Alert: Status -> Fullscreen: ${videoStatus.isFullscreen}, Playing: ${videoStatus.isPlaying}`);
        console.log(`[🚫] Video properly play nahi hui ya fullscreen nahi hai! Screenshot skip kar raha hoon...`);
        await browser.close();
        return; // Cycle end, will try again in 2 minutes
    }

    console.log(`[✅] Video is PLAYING & FULLSCREEN! Proceeding with screenshot...`);

    // ==========================================
    // 📸 SCREENSHOT & THUMBNAIL GENERATION
    // ==========================================
    const rawFrame = `temp_raw_frame_${Date.now()}.jpg`;
    
    try {
        const videoElement = await targetFrame.$('video[data-html5-video], video');
        if (videoElement) {
            await videoElement.screenshot({ path: rawFrame, type: 'jpeg', quality: 90 });
        } else {
            await page.screenshot({ path: rawFrame, type: 'jpeg', quality: 90 });
        }
    } catch (e) {
        console.log(`[❌] Screenshot failed: ${e.message}`);
        await browser.close();
        return;
    }

    if (!fs.existsSync(rawFrame)) {
        await browser.close();
        return;
    }

    console.log(`[🎨] Generating HD Thumbnail with template...`);
    const b64Image = "data:image/jpeg;base64," + fs.readFileSync(rawFrame).toString('base64');
    
    const htmlCode = `<!DOCTYPE html><html><head><link href="https://fonts.googleapis.com/css2?family=Roboto:wght@700;900&display=swap" rel="stylesheet"><style>body { margin: 0; width: 1280px; height: 720px; background: #0f0f0f; font-family: 'Roboto', sans-serif; color: white; display: flex; flex-direction: column; overflow: hidden; } .header { height: 100px; display: flex; align-items: center; padding: 0 40px; justify-content: space-between; z-index: 10; } .logo { font-size: 50px; font-weight: 900; letter-spacing: 1px; text-shadow: 0 0 10px rgba(255,255,255,0.8); } .live-badge { border: 4px solid #cc0000; border-radius: 12px; padding: 5px 20px; font-size: 40px; font-weight: 700; display: flex; gap: 10px; } .hero-container { position: relative; width: 100%; height: 440px; } .hero-img { width: 100%; height: 100%; object-fit: cover; filter: blur(5px); opacity: 0.6; } .pip-img { position: absolute; top: 20px; right: 40px; width: 45%; border: 6px solid white; box-shadow: -15px 15px 30px rgba(0,0,0,0.8); } .text-container { position: relative; z-index: 999; flex-grow: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 10px 40px; } .main-title { font-size: 70px; font-weight: 900; line-height: 1.1; text-shadow: 6px 6px 15px rgba(0,0,0,0.9); } .live-text { color: #cc0000; }</style></head><body><div class="header"><div class="logo">SPORTSHUB</div><div class="live-badge"><span style="color:#cc0000">●</span> LIVE</div></div><div class="hero-container"><img src="${b64Image}" class="hero-img"><img src="${b64Image}" class="pip-img"></div><div class="text-container"><div class="main-title"><span class="live-text">🔴 Watch Live : </span>bulbul4u-live.xyz</div></div></body></html>`;

    await page.setContent(htmlCode);
    
    const uniqueTime = Date.now();
    const outputImagePath = `Live_Thumbnail_${uniqueTime}.png`; 
    await page.screenshot({ path: outputImagePath });
    
    await browser.close();
    if (fs.existsSync(rawFrame)) fs.unlinkSync(rawFrame); 
    
    console.log(`[✅] Thumbnail Ready: ${outputImagePath}`);

    // ==========================================
    // 📤 GITHUB RELEASE UPLOAD (ADD NEW)
    // ==========================================
    console.log(`[📤] Uploading Thumbnail to GitHub Releases...`);
    try {
        const tagName = `thumbnail-${uniqueTime}`;
        execSync(`gh release create ${tagName} "${outputImagePath}" --title "Live Match Update #${cycleCounter}" --notes "Auto-generated thumbnail from the stream."`, { stdio: 'inherit' });
        console.log(`✅ [+] Successfully uploaded ${outputImagePath} to new release!`);
    } catch (err) {
        console.log(`[❌] Upload failed. Error: ${err.message}`);
    }

    if (fs.existsSync(outputImagePath)) fs.unlinkSync(outputImagePath);

    console.log(`\n[⏳] Cycle #${cycleCounter} Complete! Waiting 2 minutes for the next cycle...`);
    cycleCounter++;
}

// 🔥 MAIN LOOP FUNCTION 🔥
async function main() {
    while (true) {
        await generateAndUploadThumbnail();
        await new Promise(resolve => setTimeout(resolve, WAIT_TIME_MS));
    }
}

main();
























// ======== very well, bas screenshot full website k lee raha hai yeh issue hai below code mei ================





// const puppeteer = require('puppeteer-extra');
// const StealthPlugin = require('puppeteer-extra-plugin-stealth');
// puppeteer.use(StealthPlugin());

// const { execSync } = require('child_process');
// const fs = require('fs');

// // ==========================================
// // ⚙️ SETTINGS & ENVIRONMENT VARIABLES
// // ==========================================
// const TARGET_URL = process.env.TARGET_URL || 'https://dlstreams.com/watch.php?id=316';
// const WAIT_TIME_MS = 120 * 1000; // 2 Minutes wait time

// let cycleCounter = 1;

// async function generateAndUploadThumbnail() {
//     console.log(`\n--------------------------------------------------`);
//     console.log(`--- 🔄 STARTING THUMBNAIL CYCLE #${cycleCounter} ---`);
//     console.log(`--------------------------------------------------`);
    
//     const browser = await puppeteer.launch({
//         channel: 'chrome', 
//         headless: false, 
//         defaultViewport: { width: 1280, height: 720 },
//         args: ['--no-sandbox', '--disable-setuid-sandbox']
//     });

//     const page = await browser.newPage();
//     console.log(`[*] Navigating to target URL: ${TARGET_URL}...`);
    
//     await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
//     await new Promise(r => setTimeout(r, 10000)); // Wait for player to load

//     let targetFrame = null;

//     console.log('[*] Scanning iframes for the Live Stream Video...');
//     for (const frame of page.frames()) {
//         try {
//             const isRealLiveStream = await frame.evaluate(() => {
//                 const vid = document.querySelector('video[data-html5-video]') || document.querySelector('video');
//                 return vid && vid.clientWidth > 300; 
//             });
//             if (isRealLiveStream) {
//                 targetFrame = frame;
//                 break;
//             }
//         } catch (e) { }
//     }

//     if (!targetFrame) {
//         console.log('[!] No iframe video found. Defaulting to main page...');
//         targetFrame = page;
//     }

//     const rawFrame = `temp_raw_frame_${Date.now()}.jpg`;
    
//     try {
//         console.log(`[>] Extracting video player frame...`);
//         const videoElement = await targetFrame.$('video[data-html5-video], video');
//         if (videoElement) {
//             await videoElement.screenshot({ path: rawFrame, type: 'jpeg', quality: 90 });
//         } else {
//             await page.screenshot({ path: rawFrame, type: 'jpeg', quality: 90 });
//         }
//     } catch (e) {
//         console.log(`[❌] Screenshot failed: ${e.message}`);
//         await browser.close();
//         return;
//     }

//     if (!fs.existsSync(rawFrame)) {
//         console.log('[❌] Image not saved.');
//         await browser.close();
//         return;
//     }

//     console.log(`[🎨] Generating HD Thumbnail with template...`);
//     const b64Image = "data:image/jpeg;base64," + fs.readFileSync(rawFrame).toString('base64');
    
//     const htmlCode = `<!DOCTYPE html><html><head><link href="https://fonts.googleapis.com/css2?family=Roboto:wght@700;900&display=swap" rel="stylesheet"><style>body { margin: 0; width: 1280px; height: 720px; background: #0f0f0f; font-family: 'Roboto', sans-serif; color: white; display: flex; flex-direction: column; overflow: hidden; } .header { height: 100px; display: flex; align-items: center; padding: 0 40px; justify-content: space-between; z-index: 10; } .logo { font-size: 50px; font-weight: 900; letter-spacing: 1px; text-shadow: 0 0 10px rgba(255,255,255,0.8); } .live-badge { border: 4px solid #cc0000; border-radius: 12px; padding: 5px 20px; font-size: 40px; font-weight: 700; display: flex; gap: 10px; } .hero-container { position: relative; width: 100%; height: 440px; } .hero-img { width: 100%; height: 100%; object-fit: cover; filter: blur(5px); opacity: 0.6; } .pip-img { position: absolute; top: 20px; right: 40px; width: 45%; border: 6px solid white; box-shadow: -15px 15px 30px rgba(0,0,0,0.8); } .text-container { position: relative; z-index: 999; flex-grow: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 10px 40px; } .main-title { font-size: 70px; font-weight: 900; line-height: 1.1; text-shadow: 6px 6px 15px rgba(0,0,0,0.9); } .live-text { color: #cc0000; }</style></head><body><div class="header"><div class="logo">SPORTSHUB</div><div class="live-badge"><span style="color:#cc0000">●</span> LIVE</div></div><div class="hero-container"><img src="${b64Image}" class="hero-img"><img src="${b64Image}" class="pip-img"></div><div class="text-container"><div class="main-title"><span class="live-text">🔴 Watch Live : </span>bulbul4u-live.xyz</div></div></body></html>`;

//     await page.setContent(htmlCode);
    
//     // Give the file a unique timestamp name so it doesn't overwrite
//     const uniqueTime = Date.now();
//     const outputImagePath = `Live_Thumbnail_${uniqueTime}.png`; 
//     await page.screenshot({ path: outputImagePath });
    
//     await browser.close();
//     if (fs.existsSync(rawFrame)) fs.unlinkSync(rawFrame); 
    
//     console.log(`[✅] Thumbnail Ready: ${outputImagePath}`);

//     // ==========================================
//     // 📤 GITHUB RELEASE UPLOAD (NO DELETION HERE)
//     // ==========================================
//     console.log(`[📤] Uploading Thumbnail to GitHub Releases...`);
//     try {
//         const tagName = `thumbnail-${uniqueTime}`;

//         // Just create a new release, keep everything else
//         execSync(`gh release create ${tagName} "${outputImagePath}" --title "Live Match Update #${cycleCounter}" --notes "Auto-generated thumbnail from the stream."`, { stdio: 'inherit' });
        
//         console.log(`✅ [+] Successfully uploaded ${outputImagePath} to new release!`);
//     } catch (err) {
//         console.log(`[❌] Upload failed. Error: ${err.message}`);
//     }

//     // Clean up local file so GitHub server space doesn't get full
//     if (fs.existsSync(outputImagePath)) fs.unlinkSync(outputImagePath);

//     console.log(`\n[⏳] Cycle #${cycleCounter} Complete! Waiting 2 minutes for the next cycle...`);
//     cycleCounter++;
// }

// // Loop runs forever while the GitHub Action is active
// async function main() {
//     while (true) {
//         await generateAndUploadThumbnail();
//         await new Promise(resolve => setTimeout(resolve, WAIT_TIME_MS));
//     }
// }

// main();
