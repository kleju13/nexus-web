import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KrakenCoolerSettings } from './KrakenCoolerSettings';
import { KrakenDevicePage } from './KrakenDevicePage';

/* eslint-disable @typescript-eslint/no-explicit-any */

vi.mock('../../../lib/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

const mockGetKrakenState = vi.fn();
const mockSetKrakenLcd = vi.fn();
const mockUpload = vi.fn();
const mockGetFirmwareLighting = vi.fn();
const mockEncode = vi.fn();
const mockUploadGif = vi.fn();
const mockUploadKlipy = vi.fn();

vi.mock('../../../api/nzxt-kraken', () => ({
  KRAKEN_LCD_WEB_FPS_MIN: 1,
  KRAKEN_LCD_WEB_FPS_MAX: 30,
  getKrakenState: (...args: any[]) => mockGetKrakenState(...args),
  setKrakenLcd: (...args: any[]) => mockSetKrakenLcd(...args),
  uploadKrakenLcdImage: (...args: any[]) => mockUpload(...args),
  encodeKrakenFrame: (...args: any[]) => mockEncode(...args),
  uploadKrakenLcdGif: (...args: any[]) => mockUploadGif(...args),
  uploadKrakenLcdKlipy: (...args: any[]) => mockUploadKlipy(...args),
  // The settings body mounts the firmware-lighting section too; without these the
  // section's effect rejects and the run fails on an unhandled rejection.
  getKrakenFirmwareLighting: (...args: any[]) => mockGetFirmwareLighting(...args),
  setKrakenFirmwareLighting: vi.fn(),
}));

vi.mock('../../common/KlipyPicker/KlipyPicker', () => ({
  KlipyPicker: ({ open, onPick }: { open: boolean; onPick: (gif: unknown) => void }) => (open
    ? <button type="button" onClick={() => onPick({ slug: 'cat', title: 'Cat', width: 480, height: 270 })}>klipy-pick</button>
    : null),
}));

const connectedState = {
  isConnected: true,
  firmwareVersion: '1.2.0',
  liquidTempC: 27.4,
  pumpRpm: 1876,
  pumpDuty: 40,
  fanRpm: 845,
  fanDuty: 35,
  hasLcd: true,
  lcdWidth: 640,
  lcdHeight: 640,
  lcdBrightness: 80,
  lcdOrientation: 0,
  lcdMode: 'liquid' as const,
  lcdStream: true,
  lcdSource: 'device' as const,
  channels: [
    { id: 'nzxt-kraken:led-ring', accessoryName: 'Kraken Elite Ring', ledCount: 24 },
    { id: 'nzxt-kraken:led-fans', accessoryName: 'F240 RGB Core', ledCount: 16 },
  ],
};

beforeEach(() => {
  vi.useFakeTimers();
  mockGetKrakenState.mockResolvedValue(connectedState);
  mockGetFirmwareLighting.mockResolvedValue({ isConnected: true, effects: [], channels: [] });
  mockSetKrakenLcd.mockResolvedValue({});
  mockUpload.mockResolvedValue(true);
  mockUploadGif.mockResolvedValue(true);
  mockUploadKlipy.mockResolvedValue(true);
  mockEncode.mockResolvedValue(new Uint8Array(4));
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2, height: 2, close: vi.fn() }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('KrakenDevicePage', () => {
  it('renders telemetry for the pump and the fan chain', async () => {
    await act(async () => { render(<KrakenDevicePage />); });

    expect(screen.getByText('devices.nzxt-kraken.statusSection')).toBeInTheDocument();
    // Numbers go through the locale formatter, so match on the unit-suffixed text.
    expect(screen.getByText(/1[,.\s]?876 RPM/)).toBeInTheDocument();
    expect(screen.getByText(/845 RPM/)).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('35%')).toBeInTheDocument();
  });

  it('lists each RGB channel the cooler reported with its LED count', async () => {
    await act(async () => { render(<KrakenDevicePage />); });

    expect(screen.getByText('Kraken Elite Ring')).toBeInTheDocument();
    expect(screen.getByText('F240 RGB Core')).toBeInTheDocument();
    expect(screen.getByText('devices.nzxt-kraken.ledCount:{"n":24}')).toBeInTheDocument();
    expect(screen.getByText('devices.nzxt-kraken.ledCount:{"n":16}')).toBeInTheDocument();
  });

  it('shows the disconnected state when the cooler is not present', async () => {
    mockGetKrakenState.mockResolvedValue({ ...connectedState, isConnected: false });

    await act(async () => { render(<KrakenDevicePage />); });

    expect(screen.getByText('devices.nzxt-kraken.notConnected')).toBeInTheDocument();
    expect(screen.queryByText('devices.nzxt-kraken.statusSection')).not.toBeInTheDocument();
  });

  it('explains the screen is unavailable when the bulk pipe did not open', async () => {
    mockGetKrakenState.mockResolvedValue({ ...connectedState, hasLcd: false });

    await act(async () => { render(<KrakenDevicePage />); });

    expect(screen.getByText('devices.nzxt-kraken.screenUnavailable')).toBeInTheDocument();
    // Controls are hidden rather than shown-but-broken.
    expect(screen.queryByText('devices.nzxt-kraken.screenPickImage')).not.toBeInTheDocument();
  });
});

describe('KrakenDevicePage - screen source', () => {
  const pickSource = async (label: string) => {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'devices.nzxt-kraken.screenSource' })); });
    await act(async () => { fireEvent.click(screen.getByRole('option', { name: label })); });
  };

  const webState = {
    ...connectedState,
    lcdSource: 'web' as const,
    lcdWebUrl: 'http://127.0.0.1:30640/?camless=on',
    lcdWebFps: 10,
    lcdWebState: 'running' as const,
    lcdWebBrowser: 'Microsoft Edge',
    lcdWebActualFps: 9.6,
    lcdWebBackground: 0,
  };

  it('offers the Nexus panel, a web page and the cooler, and saves the pick', async () => {
    await act(async () => { render(<KrakenDevicePage />); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'devices.nzxt-kraken.screenSource' })); });
    expect(screen.getByRole('option', { name: 'devices.nzxt-kraken.screenSourceNexus' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'devices.nzxt-kraken.screenSourceDevice' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('option', { name: 'devices.nzxt-kraken.screenSourceWeb' })); });

    expect(mockSetKrakenLcd).toHaveBeenCalledWith({ source: 'web' });
  });

  it('shows the page, its frame rate and how it runs for the web source, and no image controls', async () => {
    mockGetKrakenState.mockResolvedValue(webState);
    await act(async () => { render(<KrakenDevicePage />); });

    expect(screen.getByRole('textbox', { name: 'devices.nzxt-kraken.screenWebUrl' })).toHaveValue('http://127.0.0.1:30640/?camless=on');
    expect(screen.getByText('devices.nzxt-kraken.screenWebFps')).toBeInTheDocument();
    expect(screen.getByText('devices.nzxt-kraken.screenWebStateRunning')).toBeInTheDocument();
    expect(screen.getByText(/devices\.nzxt-kraken\.screenWebRunning:.*Microsoft Edge/)).toBeInTheDocument();
    expect(screen.queryByText('devices.nzxt-kraken.screenPickImage')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'devices.nzxt-kraken.screenMode' })).not.toBeInTheDocument();
  });

  it('shows why the page is not running', async () => {
    mockGetKrakenState.mockResolvedValue({ ...webState, lcdWebState: 'error', lcdWebError: 'Microsoft Edge did not open its DevTools port' });
    await act(async () => { render(<KrakenDevicePage />); });

    expect(screen.getByText('devices.nzxt-kraken.screenWebStateError')).toBeInTheDocument();
    expect(screen.getByText('Microsoft Edge did not open its DevTools port')).toBeInTheDocument();
  });

  it('refuses a page address that is not http or https, and saves one that is', async () => {
    mockGetKrakenState.mockResolvedValue(webState);
    await act(async () => { render(<KrakenDevicePage />); });
    const field = screen.getByRole('textbox', { name: 'devices.nzxt-kraken.screenWebUrl' });

    await act(async () => { fireEvent.blur(field, { target: { value: 'javascript:alert(1)' } }); });
    expect(screen.getByText('devices.nzxt-kraken.screenWebUrlInvalid')).toBeInTheDocument();
    expect(mockSetKrakenLcd).not.toHaveBeenCalled();

    await act(async () => { fireEvent.blur(field, { target: { value: ' https://example.com/dial ' } }); });
    expect(mockSetKrakenLcd).toHaveBeenCalledWith({ webUrl: 'https://example.com/dial' });

    await act(async () => { fireEvent.blur(field, { target: { value: '' } }); });
    expect(mockSetKrakenLcd).toHaveBeenLastCalledWith({ webUrl: '' });
  });

  it('keeps the panel note and hides the image controls while the Nexus panel draws', async () => {
    mockGetKrakenState.mockResolvedValue({ ...connectedState, lcdSource: 'nexus' });
    await act(async () => { render(<KrakenCoolerSettings screenStreamed />); });

    expect(screen.getByText('devices.nzxt-kraken.screenOwnedByPanel')).toBeInTheDocument();
    expect(screen.queryByText('devices.nzxt-kraken.screenPickImage')).not.toBeInTheDocument();
    await pickSource('devices.nzxt-kraken.screenSourceWeb');
    expect(mockSetKrakenLcd).toHaveBeenCalledWith({ source: 'web' });
  });

  it('keeps a model without the streaming buffer on its own screens', async () => {
    mockGetKrakenState.mockResolvedValue({ ...connectedState, lcdStream: false });
    await act(async () => { render(<KrakenDevicePage />); });

    expect(screen.getByText('devices.nzxt-kraken.screenStreamUnavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'devices.nzxt-kraken.screenSource' })).not.toBeInTheDocument();
    expect(screen.queryByText('devices.nzxt-kraken.screenPickImage')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'devices.nzxt-kraken.screenMode' })); });
    expect(screen.getByRole('option', { name: 'devices.nzxt-kraken.screenModeLiquid' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'devices.nzxt-kraken.screenModeImage' })).not.toBeInTheDocument();
  });
});

describe('KrakenDevicePage - GIF screen', () => {
  const pick = async (file: File) => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
  };

  it('hides the GIFs button when the model does not play GIFs', async () => {
    await act(async () => { render(<KrakenDevicePage />); });

    expect(screen.queryByRole('button', { name: 'lighting.controls.klipyBrowse' })).not.toBeInTheDocument();
  });

  it('sends a picked GIF to the gif call when the model plays GIFs', async () => {
    mockGetKrakenState.mockResolvedValue({ ...connectedState, lcdGif: true });
    await act(async () => { render(<KrakenDevicePage />); });

    const gif = new File(['GIF89a'], 'a.gif', { type: 'image/gif' });
    await pick(gif);

    expect(mockUploadGif).toHaveBeenCalledWith(gif);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('keeps the still-frame path for a PNG even when the model plays GIFs', async () => {
    mockGetKrakenState.mockResolvedValue({ ...connectedState, lcdGif: true });
    await act(async () => { render(<KrakenDevicePage />); });

    await pick(new File(['png'], 'a.png', { type: 'image/png' }));

    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUploadGif).not.toHaveBeenCalled();
  });

  it('treats a GIF as a still frame when the model does not play GIFs', async () => {
    await act(async () => { render(<KrakenDevicePage />); });

    await pick(new File(['GIF89a'], 'a.gif', { type: 'image/gif' }));

    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUploadGif).not.toHaveBeenCalled();
  });

  it('uploads a Klipy pick through the klipy call', async () => {
    mockGetKrakenState.mockResolvedValue({ ...connectedState, lcdGif: true });
    await act(async () => { render(<KrakenDevicePage />); });

    fireEvent.click(screen.getByRole('button', { name: 'lighting.controls.klipyBrowse' }));
    await act(async () => { fireEvent.click(screen.getByText('klipy-pick')); });

    expect(mockUploadKlipy).toHaveBeenCalledWith('cat');
  });

  it('shows the upload error when a GIF upload fails', async () => {
    mockGetKrakenState.mockResolvedValue({ ...connectedState, lcdGif: true });
    mockUploadGif.mockResolvedValue(false);
    await act(async () => { render(<KrakenDevicePage />); });

    await pick(new File(['GIF89a'], 'a.gif', { type: 'image/gif' }));

    expect(screen.getByText('devices.nzxt-kraken.screenUploadFailed')).toBeInTheDocument();
  });
});
