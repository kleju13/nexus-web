import { useCallback, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Lightbulb, Sparkles, Unplug } from 'lucide-react';
import { EmptyState } from '../../common/EmptyState/EmptyState';
import { SettingRow, SettingSelect, SettingSlider, SettingToggle, type SettingState } from '../../common/SettingRow/SettingRow';
import { Button } from '../../common/Button/Button';
import { SettingsSection } from '../../common/SettingsSection/SettingsSection';
import { TextInput } from '../../common/TextInput/TextInput';
import {
  KRAKEN_LCD_WEB_FPS_MAX,
  KRAKEN_LCD_WEB_FPS_MIN,
  encodeKrakenFrame,
  getKrakenState,
  setKrakenLcd,
  uploadKrakenLcdGif,
  uploadKrakenLcdImage,
  uploadKrakenLcdKlipy,
  type KrakenLcdPatch,
  type KrakenLcdSource,
  type KrakenLcdWebState,
  type KrakenState,
} from '../../../api/nzxt-kraken';
import type { KlipyGif } from '../../../api/klipy';
import { KlipyPicker } from '../../common/KlipyPicker/KlipyPicker';
import { useUnitPrefs } from '../../../hooks/useUiSettings';
import { useTranslation } from '../../../lib/i18n';
import { convertTemperature, formatNumber, localizeNumbers, tempUnitSymbol } from '../../../lib/units';
import { KrakenFirmwareLightingSection } from './KrakenFirmwareLighting';
import styles from './LianLiDevicePage.module.scss';
import { useReportDeviceWaiting } from './deviceDetecting';

// Matches the service status poll so the readout tracks the cooler without adding load.
const STATE_POLL_MS = 1000;

const LCD_MODES: { value: KrakenState['lcdMode']; labelKey: string }[] = [
  { value: 'liquid', labelKey: 'devices.nzxt-kraken.screenModeLiquid' },
  { value: 'image', labelKey: 'devices.nzxt-kraken.screenModeImage' },
  { value: 'off', labelKey: 'devices.nzxt-kraken.screenModeOff' },
];

const LCD_ROTATIONS = [0, 90, 180, 270];

const LCD_SOURCES: { value: KrakenLcdSource; labelKey: string; noteKey: string }[] = [
  { value: 'nexus', labelKey: 'devices.nzxt-kraken.screenSourceNexus', noteKey: 'devices.nzxt-kraken.screenSourceNexusNote' },
  { value: 'web', labelKey: 'devices.nzxt-kraken.screenSourceWeb', noteKey: 'devices.nzxt-kraken.screenSourceWebNote' },
  { value: 'device', labelKey: 'devices.nzxt-kraken.screenSourceDevice', noteKey: 'devices.nzxt-kraken.screenSourceDeviceNote' },
];

const WEB_STATES: Record<KrakenLcdWebState, { labelKey: string; tone: SettingState['tone'] }> = {
  off: { labelKey: 'devices.nzxt-kraken.screenWebStateOff', tone: 'neutral' },
  waiting: { labelKey: 'devices.nzxt-kraken.screenWebStateWaiting', tone: 'neutral' },
  unsupported: { labelKey: 'devices.nzxt-kraken.screenWebStateUnsupported', tone: 'warn' },
  starting: { labelKey: 'devices.nzxt-kraken.screenWebStateStarting', tone: 'accent' },
  running: { labelKey: 'devices.nzxt-kraken.screenWebStateRunning', tone: 'good' },
  error: { labelKey: 'devices.nzxt-kraken.screenWebStateError', tone: 'warn' },
  unavailable: { labelKey: 'devices.nzxt-kraken.screenWebStateUnavailable', tone: 'warn' },
};

/** What the service takes for the web source: empty (KrakenDial) or an http(s) address. */
function isAllowedWebUrl(url: string): boolean {
  if (url === '') return true;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host !== '' && url.length <= 2048;
  } catch {
    return false;
  }
}

/**
 * The Kraken's hardware options: cooling readout, the LCD's own display controls,
 * and the RGB channel summary. Hosted by the LCD panel page's settings tab, and by
 * KrakenDevicePage when no panel session exists to host it.
 */
export function KrakenCoolerSettings({ onSectionNavigate, screenStreamed = false }: {
  onSectionNavigate?: (section: string) => void;
  // True when a panel session owns the LCD. It sends a frame many times a second, so a
  // display mode or a still image picked here is overwritten within a frame period; the
  // controls that lose are hidden rather than left there looking broken.
  screenStreamed?: boolean;
}) {
  const { t } = useTranslation();
  const { numberFormat, monitoringTempUnit } = useUnitPrefs();
  const [connection, setConnection] = useState<'unknown' | 'connected' | 'disconnected'>('unknown');
  useReportDeviceWaiting(connection !== 'connected');
  const [state, setState] = useState<KrakenState | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const [klipyOpen, setKlipyOpen] = useState(false);
  const [klipyBusy, setKlipyBusy] = useState<string | null>(null);
  const aliveRef = useRef(true);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Set while the brightness thumb is being dragged, so the poll below keeps the local
  // value instead of snapping it back to whatever the cooler last reported.
  const brightnessDirtyRef = useRef(false);
  // Same guard for the sleep toggle while its write is in flight.
  const sleepDirtyRef = useRef(false);
  // And for the web page's frame rate while its thumb is dragged.
  const webFpsDirtyRef = useRef(false);
  const [webUrlInvalid, setWebUrlInvalid] = useState(false);

  const refresh = useCallback(async () => {
    const s = await getKrakenState();
    if (!aliveRef.current || s === null) return;
    if (!s.isConnected) {
      setConnection('disconnected');
      setState(null);
      return;
    }
    setConnection('connected');
    setState(prev => {
      if (!prev) return s;
      let merged = s;
      if (brightnessDirtyRef.current) merged = { ...merged, lcdBrightness: prev.lcdBrightness };
      if (sleepDirtyRef.current) merged = { ...merged, lcdSleepWhenLocked: prev.lcdSleepWhenLocked };
      if (webFpsDirtyRef.current) merged = { ...merged, lcdWebFps: prev.lcdWebFps };
      return merged;
    });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    const id = window.setInterval(() => { void refresh(); }, STATE_POLL_MS);
    return () => {
      aliveRef.current = false;
      window.removeEventListener('focus', onFocus);
      window.clearInterval(id);
    };
  }, [refresh]);

  const commitLcd = useCallback(async (patch: KrakenLcdPatch) => {
    setSaving(true);
    try {
      const ok = (await setKrakenLcd(patch)) !== null;
      await refresh();
      return ok;
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  }, [refresh]);

  const commitWebUrl = useCallback(async (raw: string) => {
    const url = raw.trim();
    if (!isAllowedWebUrl(url)) {
      setWebUrlInvalid(true);
      return;
    }
    setWebUrlInvalid(false);
    if (url === state?.lcdWebUrl) return;
    if (!(await commitLcd({ webUrl: url })) && aliveRef.current) setWebUrlInvalid(true);
  }, [commitLcd, state?.lcdWebUrl]);

  const onPickImage = useCallback(async (file: File | undefined) => {
    if (!file || !state) return;
    setSaving(true);
    setUploadError(false);
    try {
      if (state.lcdGif && file.type === 'image/gif') {
        const ok = await uploadKrakenLcdGif(file);
        if (aliveRef.current && !ok) setUploadError(true);
        await refresh();
        return;
      }
      const bitmap = await createImageBitmap(file);
      try {
        const rgba = await encodeKrakenFrame(
          bitmap, state.lcdWidth, state.lcdHeight, bitmap.width, bitmap.height);
        const ok = await uploadKrakenLcdImage(rgba);
        if (aliveRef.current && !ok) setUploadError(true);
      } finally {
        bitmap.close();
      }
      await refresh();
    } catch {
      if (aliveRef.current) setUploadError(true);
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  }, [state, refresh]);

  const onPickKlipy = useCallback(async (gif: KlipyGif) => {
    setKlipyBusy(gif.slug);
    setSaving(true);
    setUploadError(false);
    try {
      const ok = await uploadKrakenLcdKlipy(gif.slug);
      if (!aliveRef.current) return;
      if (ok) {
        setKlipyOpen(false);
        await refresh();
      } else {
        setUploadError(true);
      }
    } finally {
      if (aliveRef.current) {
        setKlipyBusy(null);
        setSaving(false);
      }
    }
  }, [refresh]);

  if (connection === 'disconnected') {
    return <EmptyState icon={<Unplug size={40} />} title={t('devices.nzxt-kraken.notConnected')} />;
  }

  const loaded = state !== null;
  // Models without the streaming buffer keep their own screens: a still, a panel or a page
  // would go through a memory bucket, which writes the cooler's flash.
  const streams = state?.lcdStream === true;
  const source: KrakenLcdSource = streams ? (state?.lcdSource ?? 'nexus') : 'device';
  // The overlay draws the panel only while its session is up; until then the cooler's
  // own controls still apply.
  const deviceControls = source === 'device' || (source === 'nexus' && !screenStreamed);
  const sourceOption = LCD_SOURCES.find(s => s.value === source);
  const webState = state?.lcdWebState ? WEB_STATES[state.lcdWebState] : undefined;
  const webBrowser = state?.lcdWebBrowser ?? '';
  const webFps = formatNumber(state?.lcdWebActualFps ?? 0, numberFormat, { maximumFractionDigits: 1 });
  const webDetail = state?.lcdWebState === 'running'
    ? t((state.lcdWebBackground ?? 0) > 0 ? 'devices.nzxt-kraken.screenWebRunningLoop' : 'devices.nzxt-kraken.screenWebRunning',
      { fps: webFps, browser: webBrowser })
    : state?.lcdWebError ?? undefined;

  return (
    <>
      <SettingsSection
        title={t('devices.nzxt-kraken.statusSection')}
        boxClassName={styles.sectionBox}
      >
        <div className={`${styles.row} ${!loaded ? styles.rowDisabled : ''}`}>
          <span className={styles.rowLabel}>{t('devices.nzxt-kraken.liquid')}</span>
          <span className={styles.rowValue}>
            {loaded
              ? `${formatNumber(convertTemperature(state.liquidTempC, monitoringTempUnit), numberFormat, { maximumFractionDigits: 1 })}${tempUnitSymbol(monitoringTempUnit)}`
              : ''}
          </span>
          <span className={styles.rowValue} />
        </div>
        <div className={`${styles.row} ${!loaded ? styles.rowDisabled : ''}`}>
          <span className={styles.rowLabel}>{t('devices.nzxt-kraken.pump')}</span>
          <span className={styles.rowValue}>{loaded ? `${formatNumber(state.pumpRpm, numberFormat)} RPM` : ''}</span>
          <span className={styles.rowValue}>{loaded ? localizeNumbers(`${state.pumpDuty}%`, numberFormat) : ''}</span>
        </div>
        <div className={`${styles.row} ${!loaded ? styles.rowDisabled : ''}`}>
          <span className={styles.rowLabel}>{t('devices.nzxt-kraken.fans')}</span>
          <span className={styles.rowValue}>{loaded ? `${formatNumber(state.fanRpm, numberFormat)} RPM` : ''}</span>
          <span className={styles.rowValue}>{loaded ? localizeNumbers(`${state.fanDuty}%`, numberFormat) : ''}</span>
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('devices.nzxt-kraken.screenSection')}
        boxClassName={styles.sectionBox}
      >
        {loaded && !state.hasLcd ? (
          <p className={styles.customNote} data-settings-aside="true">
            {t('devices.nzxt-kraken.screenUnavailable')}
          </p>
        ) : (
          <>
            {loaded && !streams && (
              <p className={styles.customNote} data-settings-aside="true">
                {t('devices.nzxt-kraken.screenStreamUnavailable')}
              </p>
            )}
            {streams && (
              <SettingSelect
                label={t('devices.nzxt-kraken.screenSource')}
                value={source}
                onChange={v => { void commitLcd({ source: v as KrakenLcdSource }); }}
                options={LCD_SOURCES.map(s => ({ value: s.value, label: t(s.labelKey) }))}
                description={sourceOption ? t(sourceOption.noteKey) : undefined}
                descriptionBelow
                disabled={!loaded || saving}
              />
            )}

            {source === 'nexus' && screenStreamed && (
              <p className={styles.customNote} data-settings-aside="true">
                {t('devices.nzxt-kraken.screenOwnedByPanel')}
              </p>
            )}
            {deviceControls && (
              <SettingSelect
                label={t('devices.nzxt-kraken.screenMode')}
                value={state?.lcdMode ?? 'liquid'}
                onChange={v => { void commitLcd({ mode: v as KrakenState['lcdMode'] }); }}
                options={LCD_MODES.filter(m => streams || m.value !== 'image').map(m => ({ value: m.value, label: t(m.labelKey) }))}
                disabled={!loaded}
              />
            )}

            {source === 'web' && (
              <>
                <SettingRow
                  label={t('devices.nzxt-kraken.screenWebUrl')}
                  description={webUrlInvalid ? t('devices.nzxt-kraken.screenWebUrlInvalid') : t('devices.nzxt-kraken.screenWebUrlNote')}
                  descriptionBelow
                  disabled={!loaded}
                >
                  <TextInput
                    value={state?.lcdWebUrl ?? ''}
                    size="sm"
                    mono
                    maxLength={2048}
                    autoComplete="off"
                    ariaLabel={t('devices.nzxt-kraken.screenWebUrl')}
                    invalid={webUrlInvalid}
                    disabled={!loaded || saving}
                    onInput={() => { if (webUrlInvalid) setWebUrlInvalid(false); }}
                    onSubmit={v => { void commitWebUrl(v); }}
                    onBlur={v => { void commitWebUrl(v); }}
                  />
                </SettingRow>
                <SettingSlider
                  editable
                  label={t('devices.nzxt-kraken.screenWebFps')}
                  value={state?.lcdWebFps ?? 10}
                  min={KRAKEN_LCD_WEB_FPS_MIN}
                  max={KRAKEN_LCD_WEB_FPS_MAX}
                  step={1}
                  formatValue={v => localizeNumbers(`${v}`, numberFormat)}
                  ariaLabel={t('devices.nzxt-kraken.screenWebFpsAria')}
                  disabled={!loaded}
                  onChange={(v: number, commit?: boolean) => {
                    if (!state) return;
                    webFpsDirtyRef.current = true;
                    setState({ ...state, lcdWebFps: v });
                    if (commit) void commitLcd({ webFps: v }).finally(() => { webFpsDirtyRef.current = false; });
                  }}
                  onCommit={(v: number) => {
                    void commitLcd({ webFps: v }).finally(() => { webFpsDirtyRef.current = false; });
                  }}
                />
                {webState && (
                  <SettingRow
                    label={t('devices.nzxt-kraken.screenWebState')}
                    description={webDetail}
                    descriptionBelow
                    state={{ label: t(webState.labelKey), tone: webState.tone }}
                  />
                )}
              </>
            )}

            <SettingSlider
              editable
              trackFill
              label={t('devices.nzxt-kraken.screenBrightness')}
              value={state?.lcdBrightness ?? 0}
              min={0}
              max={100}
              step={1}
              formatValue={v => localizeNumbers(`${v}%`, numberFormat)}
              ariaLabel={t('devices.nzxt-kraken.screenBrightnessAria')}
              disabled={!loaded}
              onChange={(v: number, commit?: boolean) => {
                if (!state) return;
                brightnessDirtyRef.current = true;
                setState({ ...state, lcdBrightness: v });
                if (commit) void commitLcd({ brightness: v }).finally(() => { brightnessDirtyRef.current = false; });
              }}
              onCommit={(v: number) => {
                void commitLcd({ brightness: v }).finally(() => { brightnessDirtyRef.current = false; });
              }}
            />

            <SettingSelect
              label={t('devices.nzxt-kraken.screenRotation')}
              value={String(state?.lcdOrientation ?? 0)}
              onChange={v => { void commitLcd({ orientation: Number(v) }); }}
              options={LCD_ROTATIONS.map(deg => ({
                value: String(deg),
                label: localizeNumbers(`${deg}°`, numberFormat),
              }))}
              disabled={!loaded}
            />

            <SettingToggle
              label={t('devices.lcd.sleepWhenLocked')}
              checked={state?.lcdSleepWhenLocked ?? true}
              onChange={() => {
                if (!state) return;
                const next = !(state.lcdSleepWhenLocked ?? true);
                setState({ ...state, lcdSleepWhenLocked: next });
                sleepDirtyRef.current = true;
                void commitLcd({ sleepWhenLocked: next }).finally(() => {
                  sleepDirtyRef.current = false;
                  void refresh();
                });
              }}
              disabled={!loaded}
            />

            {deviceControls && streams && (
              <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={e => {
                void onPickImage(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button
              className={styles.lightingLink}
              size="sm"
              tone="neutral"
              icon={<ImageIcon size={14} />}
              disabled={!loaded || saving}
              onClick={() => fileRef.current?.click()}
            >
              {t('devices.nzxt-kraken.screenPickImage')}
            </Button>
            {state?.lcdGif && (
              <>
                <Button
                  className={styles.lightingLink}
                  size="sm"
                  tone="neutral"
                  icon={<Sparkles size={14} aria-hidden />}
                  disabled={saving}
                  onClick={() => setKlipyOpen(true)}
                >
                  {t('lighting.controls.klipyBrowse')}
                </Button>
                <KlipyPicker
                  open={klipyOpen}
                  busySlug={klipyBusy}
                  importError={klipyOpen && uploadError ? t('devices.nzxt-kraken.screenUploadFailed') : null}
                  onPick={onPickKlipy}
                  onClose={() => { setKlipyOpen(false); setUploadError(false); }}
                />
              </>
            )}
            {uploadError && (
              <p className={styles.customNote} data-settings-aside="true">
                {t('devices.nzxt-kraken.screenUploadFailed')}
              </p>
            )}
              </>
            )}
          </>
        )}
      </SettingsSection>

      <SettingsSection
        title={t('devices.nzxt-kraken.lightingSection')}
        boxClassName={styles.sectionBox}
      >
        {(state?.channels ?? []).map(ch => (
          <div key={ch.id} className={styles.row}>
            <span className={styles.rowLabel}>{ch.accessoryName}</span>
            <span className={styles.rowValue}>
              {t('devices.nzxt-kraken.ledCount', { n: ch.ledCount })}
            </span>
            <span className={styles.rowValue} />
          </div>
        ))}
        <p className={styles.customNote} data-settings-aside="true">
          {t('devices.nzxt-kraken.lightingNote')}
        </p>
        {onSectionNavigate && (
          <Button
            className={styles.lightingLink}
            size="sm"
            tone="neutral"
            icon={<Lightbulb size={14} />}
            onClick={() => onSectionNavigate('lighting')}
          >
            {t('smartLights.colorOnLightingPage')}
          </Button>
        )}
      </SettingsSection>

      <KrakenFirmwareLightingSection />
    </>
  );
}
