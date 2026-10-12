/**
 * Flipbook's additions to the KUI SeekBar:
 *  - ScanStrip: a 6 px rule above the bar. Blind: a plain fill up to the scanned position. Highlights: pass-1
 *    sprocket holes light left to right, then pass 2 fills the gaps.
 *  - changeMarkers(): grease-pencil ticks for the KUI SeekBar `markers` prop (highlights mode only).
 *  - ThumbnailMask: rendered through the SeekBar's `displayAboveThumb`, it covers the calibrated score box on the
 *    seek thumbnail (the thumbnail is drawn stretched, so frame pixels map 1:1 onto its 320×180 box).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { scaleUxToDp } from '../../utils/pixelUtils';
import { formatClock, NormRect, PictureArea, TimedMarker } from '../core';
import { FB } from '../theme';
import { FlipbookApi } from './FlipbookContext';

const pct = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%` as `${number}%`;

/** Thumbnail box size used by the KUI SeekThumbnail (tokenResolver.seekThumbnail: 320×180 at 1080p). */
export const THUMB_W = 320;
export const THUMB_H = 180;
/** Safety margin around the box when masking, fraction of the box size per side. */
export const MASK_MARGIN = 0.15;
/** Distance of the scan strip above the bottom of the SeekBar's focus container (1080p units). */
export const STRIP_BOTTOM = 44;

export const ScanStrip = ({ fb, durationMs }: { fb: FlipbookApi; durationMs: number }) => {
  if (!fb.enabled || fb.phase === 'off' || fb.phase === 'loading' || fb.phase === 'no-index' || !durationMs) {
    return null;
  }
  const p = fb.progress;
  const readTo = p ? p.readToMs / durationMs : 0;
  const done = !!fb.result;
  if (fb.mode === 'blind') {
    // Blind: position only — no per-frame lighting (bisect/hold decodes cluster at changes).
    return (
      <View style={styles.strip} testID="flipbook-scanstrip">
        <View style={[styles.fill, { width: pct(done ? 1 : readTo) }]} />
      </View>
    );
  }
  const frames = p?.frames || fb.result?.frames || 0;
  const stride = fb.result?.params.stride || 8;
  const pass1Extent = p ? (p.pass === 1 ? readTo : 1) : 0;
  const pass2Extent = done ? 1 : p && p.pass === 2 ? readTo : 0;
  const holes: number[] = [];
  if (frames) {
    for (let i = 0; i < frames; i += stride) {
      const at = i / frames;
      if (at <= pass1Extent) {
        holes.push(at);
      }
    }
  }
  return (
    <View style={styles.strip} testID="flipbook-scanstrip">
      <View style={[styles.fill, styles.fillVerify, { width: pct(pass2Extent) }]} />
      {holes.map(at => (
        <View key={at} style={[styles.hole, { left: pct(at) }]} />
      ))}
    </View>
  );
};

/**
 * Thumbnail policy for the seek bar (ThumbnailMask). Non-Flipbook titles keep the sample's rule (thumbnails only
 * while skipping). Flipbook titles additionally keep thumbnails OFF until a calibrated box and the frame geometry
 * exist, i.e. until every thumbnail can be drawn with the score box covered.
 */
export function thumbnailDisabled(isSkipping: boolean, fb: Pick<FlipbookApi, 'enabled' | 'thumbnailsAllowed'>): boolean {
  return !isSkipping || (fb.enabled && !fb.thumbnailsAllowed);
}

/** Highlights-mode ticks for the KUI SeekBar `markers` prop (ReactNodeMarker: position in the bar's units = seconds). */
export function changeMarkers(markers: TimedMarker[], pulseIndex: number | null) {
  return markers.map((m, i) => ({
    position: m.ms / 1000,
    node: (
      <View style={styles.tickWrap} testID={`flipbook-tick-${i}`}>
        <View style={[styles.tick, pulseIndex === i && styles.tickPulse]} />
        <Text style={styles.tickLabel}>{formatClock(m.ms)}</Text>
      </View>
    ),
  }));
}

/** Mask rectangle in thumbnail units (0..1 of the 320×180 thumbnail), with a safety margin. */
export function maskRectOnThumbnail(rect: NormRect, area: PictureArea, width: number, height: number): NormRect {
  const aw = area.right - area.left;
  const ah = area.bottom - area.top;
  const mx = rect.w * MASK_MARGIN;
  const my = rect.h * MASK_MARGIN;
  const x0 = (area.left + (rect.x - mx) * aw) / width;
  const y0 = (area.top + (rect.y - my) * ah) / height;
  const x1 = (area.left + (rect.x + rect.w + mx) * aw) / width;
  const y1 = (area.top + (rect.y + rect.h + my) * ah) / height;
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  return { x: cx0, y: cy0, w: Math.min(1, x1) - cx0, h: Math.min(1, y1) - cy0 };
}

/**
 * displayAboveThumb renderer: the sample's FF/RW label plus a solid block over the score box on the thumbnail.
 * The KUI draws this node right after the SeekThumbnail inside the same centred column, so a 320-wide wrapper's
 * top edge is the thumbnail's bottom edge and its left edge is the thumbnail's left edge.
 */
export const ThumbnailMask = ({ mask, children }: { mask: NormRect | null; children?: React.ReactNode }) => (
  <View style={styles.maskWrap} testID="flipbook-thumbnail-mask">
    {mask && (
      <View
        style={[
          styles.mask,
          {
            left: scaleUxToDp(mask.x * THUMB_W),
            top: -scaleUxToDp(THUMB_H) + scaleUxToDp(mask.y * THUMB_H),
            width: scaleUxToDp(mask.w * THUMB_W),
            height: scaleUxToDp(mask.h * THUMB_H),
          },
        ]}
      />
    )}
    {children}
  </View>
);

const styles = StyleSheet.create({
  // Absolutely placed just above the bar so it does not move when the KUI opens the thumbnail.
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: scaleUxToDp(STRIP_BOTTOM),
    height: scaleUxToDp(6),
    backgroundColor: FB.before,
    overflow: 'hidden',
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: FB.rule },
  fillVerify: { opacity: 0.55 },
  hole: { position: 'absolute', top: 0, bottom: 0, width: scaleUxToDp(3), backgroundColor: FB.rule },
  tickWrap: { alignItems: 'center', marginTop: -scaleUxToDp(12) },
  tick: { width: scaleUxToDp(6), height: scaleUxToDp(28), backgroundColor: FB.after, transform: [{ skewX: '-8deg' }] },
  tickPulse: { transform: [{ scale: 1.4 }] },
  tickLabel: { color: FB.rule, fontSize: scaleUxToDp(22), fontFamily: 'monospace', marginTop: scaleUxToDp(4) },
  maskWrap: { width: scaleUxToDp(THUMB_W), alignItems: 'center' },
  mask: { position: 'absolute', backgroundColor: FB.bg },
});
