import fs from 'fs';
import path from 'path';
import os from 'os';
import bmp from 'bmp-js';

// import { loadHQR, decompressHQR, loadBIG } from './hqr';

const datapath = path.join(__dirname,'../data');
const dumppath = path.join(__dirname,'../dump');

const RESOURCES = [
    { isScene: false, name: 'BIGINTRO.ACF' },
    // { isScene: false, name: 'ACTIVISI.ACF' },
    // { isScene: true, name: 'SCENE.ACF', totalScenes: 11 }, // stage 8 only has 1 run
];

let lastPaletteData = null;
let lastKeyframe = null;

const getFileExtension = (type) => {
    if (type === 'Palette') {
        return 'pal';
    } else if (type === 'KeyFrame' || type === 'DltFrame') {
        return 'lim';
    } /* else if (isWaveform(data)) {
        return 'wav';
    }*/
    return 'raw';
}

const getImageSize = (data) => {
    // switch(data.byteLength) {
    //     case 19200: // texture 160x120
    //         return { w: 160, h: 120 };
    //     case 65025: // texture 255x255
    //         return { w: 255, h: 255 };
    //     case 65536: // shading palette image 
    //         return { w: 256, h: 256 };
    //     case 106496: // texture 416x256
    //         return { w: 416, h: 256 };
    //     case 76800: // image 320x240
    //         return { w: 320, h: 240 };
    //     case 153600: // image 320x480
    //         return { w: 320, h: 480 };
    //     case 307200: // image 640x480
    //         return { w: 640, h: 480 };
    // }
    return { w: 320, h: 240 };
};

const convertBuffer = (index, type, data, filepath, filename) => {
    const view = new DataView(data);
    const { w, h } = getImageSize(data);

    lastKeyframe = new Uint8Array(w * h * 4);
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            const rawOffset = (y * w + x);
            const palOffset = view.getUint8(rawOffset, true);
    
            const r = lastPaletteData.getUint8(palOffset * 3, true);
            const g = lastPaletteData.getUint8(palOffset * 3 + 1, true);
            const b = lastPaletteData.getUint8(palOffset * 3 + 2, true);

            const offset = rawOffset * 4;
            lastKeyframe[offset    ] = 255; // alpha
            lastKeyframe[offset + 1] = b;
            lastKeyframe[offset + 2] = g;
            lastKeyframe[offset + 3] = r;
        }
    }
    const bmpData = {
        data: lastKeyframe,
        width: w,
        height: h,
    };
    const rawData = bmp.encode(bmpData);
    fs.writeFileSync(path.join(filepath, `${filename}.bmp`), rawData.data);
};

export const loadACF = (buffer, size, isScene = true) => {
    const entries = [];
    const header = new DataView(buffer);

    let offset = 0;
    let numEntries = 0;

    while (true) {
        const typeBuffer = new DataView(buffer, offset, 8);
        const type = new TextDecoder().decode(typeBuffer)
        offset += 8;
        const eSize = header.getUint32(offset, true);
        offset += 4;
        offset += eSize;
        if (type === 'End     ') {
            eSize = 0;
        }

        const e = {
            type,
            size: eSize,
            offset,
        };
        entries.push(e);

        if (eSize % 4 != 0 && eSize > 200000 || offset >= size || eSize === 0) {
            break;
        }
    }

    return entries;
};

const dumpACF = (group, filepath, name, stage) => {
    const fc = fs.readFileSync(path.join(datapath, filepath, name));
    const buffer = fc.buffer.slice(fc.byteOffset, fc.byteOffset + fc.byteLength);

    const entries = loadACF(buffer, fc.byteLength);

    console.log(entries);

    for (let e = 0; e < entries.length; e += 1) { 
        const entry = entries[e];

        const dumppathentry = path.join(dumppath, group, filepath);
        if (!fs.existsSync(dumppathentry)){
            fs.mkdirSync(dumppathentry, { recursive: true });
        }
        const ext = getFileExtension(entry.type);
        const data = new DataView(buffer, entry.offset, entry.size);
        // fs.writeFileSync(path.join(dumppathentry, `${name}_${e}.${ext}`), Buffer.from(data.buffer));

        if (entry.type === 'Palette ') {
            lastPaletteData = new DataView(data.buffer);
            console.log(entry.type);
        }
        if (entry.type === 'KeyFrame') {
            const width = 320;
            let height = 240;
            let offset = 0;
            let destOffset = 0;
            let imageData = new Uint8Array(width * height);

            do {
                const flag1 = data.getUint8(offset++, true);
        
                for (let a = 0; a < flag1; a++) {
                    let flag2 = data.getUint8(offset++, true);
        
                    if (flag2 < 0) {
                        flag2 = - flag2;
                        for (let b = 0; b < flag2; b++) {
                            imageData[destOffset++] = data.getUint8(offset++, true);
                        }
                    } else {    
                        const color = data.getUint8(offset++, true);
        
                        for (let b = 0; b < flag2; b++) {
                            imageData[destOffset++] = color;
                        }
                    }
                }
        
                // startOfLine = destPtr = startOfLine + width;
            } while (--height);

            convertBuffer(e, entry.type, imageData.buffer, dumppathentry, `${name}_${e}`);
        }
    }

    /**
     
- You can navigate between the section by reading the chunks 12 bytes by 12 bytes: The first 8 bytes is the chunk name ("Format","Palette","FrameLen", "NulChunk", "Camera", "DltFrame", ...) followed by 4 bytes with the size of the chunk.
- You can validate chunk sizes based on the fact that they have to be multiple of 4 bytes in size, and no larger than 200000 bytes

- There are two types of "frames", there are "KeyFrame" (full picture) and "DltFrame" (update over the previous picture), KeyFrames are used when there are large visual changes between two imaes

- Here is the structure definition for the "Format" chunk content:

typedef struct
{
    U32     struct_size;
    U32     delta_x;
    U32     delta_y;
    U32     frame_size;
    U32     key_size;
    U32     key_rate;
    U32     play_rate;
    U32     sampling_rate;
    U32     sample_type;
    U32     sample_flags;
    U32     compressor;        <- Can be used to differentiate ACF and XCF (PlayStation) versions of the file
} FORMAT_ACF;

And that's about it at the moment.
     */
}

for (let r = 0; r < RESOURCES.length; r += 1) {
    const res = RESOURCES[r];

    if (res.isScene) {
        for (let s = 0; s < res.totalScenes; s += 1) {
            const stage = `STAGE0${s.toString(16).toUpperCase()}`;
            dumpACF('SCENES', path.join(stage, 'RUN0'), res.name, s);
            if (s === 8 || s === 10) {
                continue; // skip second run
            }
            dumpACF('SCENES', path.join(stage, 'RUN1'), res.name, s);
        }
    } else {
        const nameNoExt = res.name.split('.')[0];
        dumpACF(nameNoExt, 'SEQUENCE', res.name, nameNoExt);
    }
}

console.log('Dump Complete!!');

process.exit(0);
