/**
 * Flipbook's on-screen layer over the player: calibration box, status line, toast, options panel, log tail.
 * Blind mode (default) never shows a count, a tick, or a per-frame trace — only how far into the match the
 * scan has read. Highlights mode adds counts here and ticks on the seek bar (FlipbookSeekbarParts).
 */
import * as base64 from 'base-64';
import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { scaleUxToDp } from '../../utils/pixelUtils';
import { formatClock } from '../core';
import { FB } from '../theme';
import { FlipbookApi, useFlipbook } from './FlipbookContext';

const pct = (v: number) => `${v * 100}%` as `${number}%`;

const PANEL_LABEL: Record<string, (fb: FlipbookApi) => string> = {
  mode: fb => `Mode: ${fb.mode === 'blind' ? 'Blind (no ticks)' : 'Highlights (ticks)'}`,
  box: () => 'Redraw score box',
  log: fb => `Engine log: ${fb.showLog ? 'on' : 'off'}`,
  close: () => 'Close',
};

/** Status text for the line above the seek bar. Blind mode: a match position only, never a count. */
export function statusText(fb: FlipbookApi): { head: string; detail: string } | null {
  if (!fb.enabled) {
    return null;
  }
  if (fb.phase === 'no-index') {
    return { head: 'NO INDEX', detail: fb.failure || 'No trickplay index for this title' };
  }
  if (fb.phase === 'loading') {
    return { head: 'FLIPBOOK', detail: 'reading trickplay index…' };
  }
  if (fb.phase === 'calibrating') {
    return null;
  }
  const p = fb.progress;
  const readTo = p ? formatClock(p.readToMs) : '0:00';
  const verifying = fb.phase === 'ready' && !fb.result;
  if (fb.mode === 'blind') {
    if (fb.phase === 'scanning') {
      return { head: 'SCANNING', detail: `read to ${readTo}` };
    }
    return { head: 'READY', detail: verifying ? `>> next change · still reading, at ${readTo}` : '>> next change · << previous' };
  }
  const n = fb.markers.length;
  const changes = `${n} CHANGE${n === 1 ? '' : 'S'}`;
  if (fb.phase === 'scanning' && p) {
    return { head: changes, detail: `read ${p.decodes} of ${p.frames} frames` };
  }
  if (verifying && p) {
    return { head: changes, detail: `verifying · read to ${readTo}` };
  }
  const r = fb.result;
  const skipped = r && r.skippedAbsent ? ` · skipped ${r.skippedAbsent} frames without the score graphic` : '';
  return { head: `${changes} FOUND`, detail: `${r ? r.frames : p?.frames ?? 0} frames read${skipped}` };
}

const CalibrationBackdrop = ({ bd }: { bd: NonNullable<FlipbookApi['backdrop']> }) => {
  const uri = useMemo(() => {
    let s = '';
    for (let i = 0; i < bd.jpeg.length; i++) {
      s += String.fromCharCode(bd.jpeg[i]);
    }
    return 'data:image/jpeg;base64,' + base64.encode(s);
  }, [bd.jpeg]);
  // Scale the frame so its PICTURE area (bars excluded) fills the screen: the box is in picture coordinates.
  const aw = bd.area.right - bd.area.left;
  const ah = bd.area.bottom - bd.area.top;
  const style = {
    position: 'absolute' as const,
    width: pct(bd.width / aw),
    height: pct(bd.height / ah),
    left: pct(-bd.area.left / aw),
    top: pct(-bd.area.top / ah),
  };
  return <Image source={{ uri }} resizeMode="stretch" style={style} testID="flipbook-backdrop" />;
};

const Calibration = ({ fb }: { fb: FlipbookApi }) => {
  const r = fb.rect;
  if (!r) {
    return null;
  }
  const moving = fb.boxState === 'moving';
  return (
    <View style={StyleSheet.absoluteFill} testID="flipbook-calibration">
      <View style={styles.backdropDim}>
        {fb.backdrop && <CalibrationBackdrop bd={fb.backdrop} />}
      </View>
      <View
        style={[
          styles.box,
          {
            left: pct(r.x),
            top: pct(r.y),
            width: pct(r.w),
            height: pct(r.h),
            borderColor: moving ? FB.after : FB.rule,
          },
        ]}
      />
      <View style={styles.calCard}>
        <Text style={styles.calHead}>PUT THE BOX ON THE SCORE</Text>
        <Text style={styles.calBody}>Keep the clock outside it. Once per broadcaster graphic.</Text>
        <Text style={styles.calKeys}>
          {fb.resizing ? 'arrows: resize' : 'arrows: move'} · SELECT: {fb.resizing ? 'move' : 'resize'} · PLAY/PAUSE: confirm
        </Text>
        <Text style={[styles.calState, { color: moving ? FB.after : FB.rule }]}>
          {fb.boxState === null ? '' : moving ? 'Box is moving — shrink it off the clock' : 'steady'}
        </Text>
      </View>
    </View>
  );
};

export const FlipbookOverlay = ({ controlsVisible }: { controlsVisible: boolean }) => {
  const fb = useFlipbook();
  if (!fb.enabled) {
    return null;
  }
  const status = statusText(fb);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="flipbook-overlay">
      {fb.phase === 'calibrating' && <Calibration fb={fb} />}
      {status && (controlsVisible || fb.phase === 'scanning' || fb.phase === 'no-index') && (
        <View style={styles.statusRow} testID="flipbook-status">
          <Text style={styles.statusHead}>{status.head}</Text>
          <Text style={styles.statusDetail}>{status.detail}</Text>
        </View>
      )}
      {fb.toast && (
        <View style={styles.toast} testID="flipbook-toast">
          <Text style={styles.toastText}>{fb.toast}</Text>
        </View>
      )}
      {fb.panelOpen && (
        <View style={styles.panel} testID="flipbook-panel">
          <Text style={styles.panelTitle}>FLIPBOOK</Text>
          {fb.panelItems.map((item, i) => (
            <Text key={item} style={[styles.panelItem, i === fb.panelIndex && styles.panelItemFocused]}>
              {PANEL_LABEL[item](fb)}
            </Text>
          ))}
          <Text style={styles.panelHint}>
            {fb.persistence === 'saved' ? 'Score box saved for this broadcaster' : fb.persistence === 'session' ? 'Box kept until you close the app' : ''}
          </Text>
        </View>
      )}
      {fb.showLog && (
        <View style={styles.log} testID="flipbook-log">
          {fb.logTail.map((l, i) => (
            <Text key={i} style={styles.logLine} numberOfLines={1}>
              {l}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  backdropDim: { ...StyleSheet.absoluteFillObject, backgroundColor: FB.bg, overflow: 'hidden' },
  box: { position: 'absolute', borderWidth: scaleUxToDp(3) },
  calCard: {
    position: 'absolute',
    left: '5%',
    right: '5%',
    bottom: '6%',
    backgroundColor: FB.scrim,
    paddingVertical: scaleUxToDp(24),
    paddingHorizontal: scaleUxToDp(36),
    borderLeftWidth: scaleUxToDp(6),
    borderLeftColor: FB.rule,
  },
  calHead: { color: FB.ink, fontSize: scaleUxToDp(48), fontWeight: '800', letterSpacing: 2 },
  calBody: { color: FB.ink, fontSize: scaleUxToDp(32), marginTop: scaleUxToDp(6) },
  calKeys: { color: FB.muted, fontSize: scaleUxToDp(28), marginTop: scaleUxToDp(10), fontFamily: 'monospace' },
  calState: { fontSize: scaleUxToDp(32), marginTop: scaleUxToDp(10), fontWeight: '700' },
  statusRow: {
    position: 'absolute',
    left: '7%',
    bottom: scaleUxToDp(300),
    flexDirection: 'row',
    alignItems: 'baseline',
    backgroundColor: FB.scrim,
    paddingHorizontal: scaleUxToDp(20),
    paddingVertical: scaleUxToDp(8),
  },
  statusHead: { color: FB.ink, fontSize: scaleUxToDp(44), fontWeight: '800', letterSpacing: 2, marginRight: scaleUxToDp(20) },
  statusDetail: { color: FB.rule, fontSize: scaleUxToDp(30), fontFamily: 'monospace' },
  toast: {
    position: 'absolute',
    top: '12%',
    alignSelf: 'center',
    backgroundColor: FB.scrim,
    borderBottomWidth: scaleUxToDp(4),
    borderBottomColor: FB.rule,
    paddingHorizontal: scaleUxToDp(32),
    paddingVertical: scaleUxToDp(14),
  },
  toastText: { color: FB.ink, fontSize: scaleUxToDp(36), fontFamily: 'monospace' },
  panel: {
    position: 'absolute',
    right: '5%',
    top: '12%',
    width: scaleUxToDp(620),
    backgroundColor: FB.bg,
    borderLeftWidth: scaleUxToDp(6),
    borderLeftColor: FB.rule,
    padding: scaleUxToDp(28),
  },
  panelTitle: { color: FB.rule, fontSize: scaleUxToDp(28), letterSpacing: 4, marginBottom: scaleUxToDp(12), fontFamily: 'monospace' },
  panelItem: { color: FB.muted, fontSize: scaleUxToDp(34), paddingVertical: scaleUxToDp(10), paddingHorizontal: scaleUxToDp(12) },
  panelItemFocused: { color: FB.bg, backgroundColor: FB.ink },
  panelHint: { color: FB.muted, fontSize: scaleUxToDp(24), marginTop: scaleUxToDp(12) },
  log: {
    position: 'absolute',
    left: '5%',
    top: '5%',
    width: '60%',
    backgroundColor: FB.scrim,
    padding: scaleUxToDp(14),
  },
  logLine: { color: FB.rule, fontSize: scaleUxToDp(22), fontFamily: 'monospace' },
});
