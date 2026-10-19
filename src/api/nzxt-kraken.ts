import { fetchService, putService, postService, postServiceBytes } from './service';

export interface KrakenChannel {
  id: string;
  accessoryName: string;
  ledCount: number;
}

export interface KrakenState {
  isConnected: boolean;
  firmwareVersion: string;
  liquidTempC: number;
  pumpRpm: number;
  pumpDuty: number;
  fanRpm: number;
  fanDuty: number;
  hasLcd: boolean;
  lcdWidth: number;
  lcdHeight: number;
  lcdBrightness: number;
  lcdOrientation: number;
  lcdMode: 'liquid' | 'image' | 'off';
  /** Absent/null = on. */
  lcdSleepWhenLocked?: boolean | null;
  /**
   * True when the attached model plays an uploaded GIF by itself. Always false in this
   * edition: that takes a memory bucket, which writes the cooler's flash.
   */
  lcdGif?: boolean;
  /**
   * True when frames reach the LCD through the streaming buffer: stills, the Nexus panel
   * and web pages. False on models that keep their own screens only.
   */
  lcdStream?: boolean;
  /** What draws the LCD. */
  lcdSource?: KrakenLcdSource;
  /** The page shown for the "web" source; the service fills in KrakenDial when unset. */
  lcdWebUrl?: string;
  lcdWebFps?: number;
  lcdWebState?: KrakenLcdWebState;
  lcdWebError?: string | null;
  /** The browser drawing the page, e.g. "Microsoft Edge". */
  lcdWebBrowser?: string | null;
  /** Frames a second the page sent over the last two seconds. */
  lcdWebActualFps?: number;
  /** Frames of the background loop the page handed over; 0 while it draws its own. */
  lcdWebBackground?: number;
  channels: KrakenChannel[];
}

/** "nexus": the Nexus panel; "web": a web page such as KrakenDial; "device": the cooler's own screens or a still. */
export type KrakenLcdSource = 'nexus' | 'web' | 'device';

export type KrakenLcdWebState = 'off' | 'waiting' | 'unsupported' | 'starting' | 'running' | 'error' | 'unavailable';

export const KRAKEN_LCD_WEB_FPS_MIN = 1;
export const KRAKEN_LCD_WEB_FPS_MAX = 30;

export interface KrakenLcdPatch {
  brightness?: number;
  orientation?: number;
  mode?: KrakenState['lcdMode'];
  sleepWhenLocked?: boolean;
  source?: KrakenLcdSource;
  /** Empty puts KrakenDial back. */
  webUrl?: string;
  webFps?: number;
}

export function getKrakenState(): Promise<KrakenState | null> {
  return fetchService<KrakenState>('/devices/nzxt-kraken/state');
}

export function setKrakenLcd(patch: KrakenLcdPatch): Promise<unknown | null> {
  return putService('/devices/nzxt-kraken/lcd', patch);
}

/** One animation the cooler plays by itself, and the palette it reads. */
export interface KrakenEffect {
  id: string;
  minColors: number;
  maxColors: number;
  directional: boolean;
}

export interface KrakenFirmwareChannel {
  id: string;
  accessoryName: string;
  effect: string;
  speed: number;
  forward: boolean;
  colors: string[];
  /** True while Nexus still pushes frames to this channel, which overrides the animation. */
  nexusDriven: boolean;
}

export interface KrakenFirmwareLighting {
  isConnected: boolean;
  effects: KrakenEffect[];
  channels: KrakenFirmwareChannel[];
}

export interface KrakenFirmwareLightingPatch {
  channel: string;
  effect: string;
  speed: number;
  forward: boolean;
  colors: string[];
}

export function getKrakenFirmwareLighting(): Promise<KrakenFirmwareLighting | null> {
  return fetchService<KrakenFirmwareLighting>('/devices/nzxt-kraken/firmware-lighting');
}

export function setKrakenFirmwareLighting(patch: KrakenFirmwareLightingPatch): Promise<unknown | null> {
  return putService('/devices/nzxt-kraken/firmware-lighting', patch);
}

/** Uploads one full-panel RGBA frame; the service rejects any other length. */
export async function uploadKrakenLcdImage(rgba: Uint8Array): Promise<boolean> {
  const r = await postServiceBytes('/devices/nzxt-kraken/lcd/image', rgba, 'application/octet-stream');
  return r !== null;
}

/** Sends the picked GIF as-is; the service converts it and uploads it to the pump. */
export async function uploadKrakenLcdGif(file: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const r = await postServiceBytes('/devices/nzxt-kraken/lcd/gif', bytes, 'image/gif');
  return r !== null;
}

/** Has the service fetch a Klipy GIF by slug, convert it, and upload it to the pump. */
export async function uploadKrakenLcdKlipy(slug: string): Promise<boolean> {
  try {
    const r = await postService<{ error?: boolean }>('/devices/nzxt-kraken/lcd/klipy', { slug });
    return r !== null && !r.error;
  } catch {
    return false;
  }
}

/**
 * Draws an image cover-cropped to the panel and returns it as RGBA. The alpha byte is
 * forced to 0: the cooler mangles colours when it is anything else.
 */
export async function encodeKrakenFrame(
  source: CanvasImageSource,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawW = sourceWidth * scale;
  const drawH = sourceHeight * scale;
  ctx.drawImage(source, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);

  const { data } = ctx.getImageData(0, 0, width, height);
  const out = new Uint8Array(width * height * 4);
  out.set(data);
  for (let i = 3; i < out.length; i += 4) out[i] = 0;
  return out;
}
