package com.ak.musicplayer;

import java.util.List;

/**
 * The sound processing behind the built-in editor, in plain Java (no Android classes) so it can
 * be tested anywhere. Audio flows through it as 16-bit stereo samples at 44.1 kHz, interleaved
 * (left, right, left, right, ...). Decoding and encoding are done by Android (see AudioEditor).
 */
final class AudioCore {

    static final int RATE = 44100;

    private AudioCore() {
    }

    /** A stream of interleaved 16-bit samples. read() fills buf and returns how many samples, or -1 at the end. */
    interface PcmIn {
        int read(short[] buf) throws Exception;
    }

    /** Raw decoder output: its own sample rate and channel count (they may change after the first read). */
    interface RawIn extends PcmIn {
        int rate();

        int channels();
    }

    interface PcmOut {
        void write(short[] buf, int count) throws Exception;
    }

    static short clip(double v) {
        return (short) Math.max(-32768, Math.min(32767, Math.round(v)));
    }

    // ------------------------------------------------------------------ format conversion
    /** Turns any decoder output (mono, stereo, 5.1; any sample rate) into 44.1 kHz stereo. */
    static final class Convert implements PcmIn {
        private final RawIn raw;
        private float[] left = new float[0], right = new float[0];
        private int count;          // frames held in left/right
        private double pos;         // read position in input frames
        private boolean eof;
        private final short[] chunk = new short[16384];

        Convert(RawIn raw) {
            this.raw = raw;
        }

        private boolean fill() throws Exception {
            if (eof) return false;
            int keepFrom = Math.max(0, Math.min(count, (int) Math.floor(pos)));
            if (keepFrom > 0) {
                System.arraycopy(left, keepFrom, left, 0, count - keepFrom);
                System.arraycopy(right, keepFrom, right, 0, count - keepFrom);
                count -= keepFrom;
                pos -= keepFrom;
            }
            int n = raw.read(chunk);
            if (n < 0) {
                eof = true;
                return false;
            }
            int ch = Math.max(1, raw.channels());
            int frames = n / ch;
            if (count + frames > left.length) {
                int size = Math.max(count + frames, left.length * 2);
                float[] l = new float[size], r = new float[size];
                System.arraycopy(left, 0, l, 0, count);
                System.arraycopy(right, 0, r, 0, count);
                left = l;
                right = r;
            }
            for (int f = 0; f < frames; f++) {
                left[count + f] = chunk[f * ch];
                right[count + f] = ch > 1 ? chunk[f * ch + 1] : chunk[f * ch];
            }
            count += frames;
            return true;
        }

        @Override
        public int read(short[] out) throws Exception {
            int o = 0;
            while (o + 2 <= out.length) {
                double step = Math.max(1, raw.rate()) / (double) RATE;
                int i0 = (int) Math.floor(pos);
                if (i0 + 1 >= count) {
                    if (fill()) continue;
                    if (i0 < count) {            // very last frame
                        out[o++] = clip(left[i0]);
                        out[o++] = clip(right[i0]);
                        pos += step;
                    }
                    break;
                }
                double f = pos - i0;
                out[o++] = clip(left[i0] + (left[i0 + 1] - left[i0]) * f);
                out[o++] = clip(right[i0] + (right[i0 + 1] - right[i0]) * f);
                pos += step;
            }
            return o > 0 ? o : -1;
        }
    }

    // ------------------------------------------------------------------ trim / cut / fade
    /**
     * Keeps only the given parts (seconds, in order, not overlapping), joins them with tiny fades so
     * the cuts don't click, and fades the start/end. Returns the number of frames written.
     */
    static long trim(PcmIn in, PcmOut out, double[][] keepSec, double fadeInSec, double fadeOutSec) throws Exception {
        int n = keepSec.length;
        long[][] keep = new long[n][2];
        long total = 0;
        for (int k = 0; k < n; k++) {
            keep[k][0] = Math.round(keepSec[k][0] * RATE);
            keep[k][1] = Math.round(keepSec[k][1] * RATE);
            total += Math.max(0, keep[k][1] - keep[k][0]);
        }
        long fi = Math.round(fadeInSec * RATE), fo = Math.round(fadeOutSec * RATE), join = Math.round(0.008 * RATE);
        short[] buf = new short[8192], ob = new short[8192];
        long pos = 0, outPos = 0;
        int seg = 0, got;
        while (seg < n && (got = in.read(buf)) > 0) {
            int o = 0;
            for (int i = 0; i + 1 < got; i += 2, pos++) {
                while (seg < n && pos >= keep[seg][1]) seg++;
                if (seg >= n) break;
                if (pos < keep[seg][0]) continue;
                double g = 1;
                if (fi > 0 && outPos < fi) g *= (double) outPos / fi;
                if (fo > 0 && total - outPos <= fo) g *= (double) (total - outPos) / fo;
                if (n > 1) {
                    long into = pos - keep[seg][0], left = keep[seg][1] - pos;
                    if (seg > 0 && into < join) g *= (double) into / join;
                    if (seg < n - 1 && left <= join) g *= (double) left / join;
                }
                ob[o++] = clip(buf[i] * g);
                ob[o++] = clip(buf[i + 1] * g);
                outPos++;
                if (o == ob.length) {
                    out.write(ob, o);
                    o = 0;
                }
            }
            if (o > 0) out.write(ob, o);
        }
        return outPos;
    }

    // ------------------------------------------------------------------ combine
    /** A first-in-first-out store of samples, used to hold back the end of each song for the crossfade. */
    static final class Fifo {
        short[] data = new short[1 << 15];
        int start, end;

        int size() {
            return end - start;
        }

        void push(short[] src, int count) {
            if (end + count > data.length) {
                int size = size();
                short[] d = data.length >= size + count ? data : new short[Math.max(data.length * 2, size + count)];
                System.arraycopy(data, start, d, 0, size);
                data = d;
                start = 0;
                end = size;
            }
            System.arraycopy(src, 0, data, end, count);
            end += count;
        }

        void popTo(PcmOut out, int count) throws Exception {
            if (count <= 0) return;
            short[] tmp = new short[count];
            System.arraycopy(data, start, tmp, 0, count);
            start += count;
            out.write(tmp, count);
        }

        short[] popAll() {
            short[] tmp = new short[size()];
            System.arraycopy(data, start, tmp, 0, tmp.length);
            start = end = 0;
            return tmp;
        }
    }

    /** Joins songs one after another, optionally overlapping them (crossfade) or with silence between. */
    static long merge(List<PcmIn> ins, PcmOut out, double crossfadeSec, double gapSec) throws Exception {
        int xf = (int) Math.round(crossfadeSec * RATE) * 2;
        int gap = crossfadeSec > 0 ? 0 : (int) Math.round(gapSec * RATE) * 2;
        final long[] written = {0};
        PcmOut counting = new PcmOut() {
            @Override
            public void write(short[] b, int c) throws Exception {
                out.write(b, c);
                written[0] += c;
            }
        };
        short[] tail = null;
        short[] buf = new short[8192];
        for (int k = 0; k < ins.size(); k++) {
            boolean last = k == ins.size() - 1;
            int hold = (xf > 0 && !last) ? xf : 0;
            Fifo fifo = new Fifo();
            int mixed = 0;
            int got;
            while ((got = ins.get(k).read(buf)) > 0) {
                if (tail != null && mixed < tail.length) {
                    int frames = tail.length / 2;
                    for (int i = 0; i + 1 < got && mixed < tail.length; i += 2, mixed += 2) {
                        double a = (double) (mixed / 2) / frames;        // 0 to 1 across the overlap
                        buf[i] = clip(tail[mixed] * (1 - a) + buf[i] * a);
                        buf[i + 1] = clip(tail[mixed + 1] * (1 - a) + buf[i + 1] * a);
                    }
                }
                fifo.push(buf, got);
                if (fifo.size() > hold) fifo.popTo(counting, fifo.size() - hold);
            }
            if (tail != null && mixed < tail.length) {           // this song was shorter than the overlap
                int frames = tail.length / 2;
                short[] rest = new short[tail.length - mixed];
                for (int i = 0; i + 1 < rest.length; i += 2) {
                    double a = (double) ((mixed + i) / 2) / frames;
                    rest[i] = clip(tail[mixed + i] * (1 - a));
                    rest[i + 1] = clip(tail[mixed + i + 1] * (1 - a));
                }
                counting.write(rest, rest.length);
            }
            if (hold > 0) {
                tail = fifo.popAll();
            } else {
                fifo.popTo(counting, fifo.size());
                tail = null;
            }
            if (gap > 0 && !last) {
                short[] silence = new short[Math.min(gap, 1 << 16)];
                for (int left = gap; left > 0; left -= silence.length) counting.write(silence, Math.min(left, silence.length));
            }
        }
        if (tail != null && tail.length > 0) counting.write(tail, tail.length);
        return written[0] / 2;
    }

    // ------------------------------------------------------------------ waveform
    /** Peak levels (0 to 1) for drawing the song. framesOut[0] receives the song length in frames. */
    static float[] waveform(PcmIn in, int points, long[] framesOut) throws Exception {
        int block = RATE / 100;
        float[] peaks = new float[1024];
        int nPeaks = 0, inBlock = 0;
        float cur = 0;
        long frames = 0;
        short[] buf = new short[8192];
        int got;
        while ((got = in.read(buf)) > 0) {
            for (int i = 0; i + 1 < got; i += 2) {
                float v = Math.max(Math.abs((float) buf[i]), Math.abs((float) buf[i + 1]));
                if (v > cur) cur = v;
                frames++;
                if (++inBlock == block) {
                    if (nPeaks == peaks.length) {
                        float[] p = new float[peaks.length * 2];
                        System.arraycopy(peaks, 0, p, 0, nPeaks);
                        peaks = p;
                    }
                    peaks[nPeaks++] = cur / 32768f;
                    cur = 0;
                    inBlock = 0;
                }
            }
        }
        if (inBlock > 0) {
            if (nPeaks == peaks.length) {
                float[] p = new float[peaks.length + 1];
                System.arraycopy(peaks, 0, p, 0, nPeaks);
                peaks = p;
            }
            peaks[nPeaks++] = cur / 32768f;
        }
        framesOut[0] = frames;
        int n = Math.max(1, Math.min(points, nPeaks));
        float[] out = new float[n];
        float top = 0;
        for (int p = 0; p < n; p++) {
            int a = (int) ((long) p * nPeaks / n), b = Math.max(a + 1, (int) ((long) (p + 1) * nPeaks / n));
            float m = 0;
            for (int i = a; i < b && i < nPeaks; i++) m = Math.max(m, peaks[i]);
            out[p] = m;
            top = Math.max(top, m);
        }
        if (top > 0) for (int p = 0; p < n; p++) out[p] /= top;
        return out;
    }
}
