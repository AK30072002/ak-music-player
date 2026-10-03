package com.ak.musicplayer;

import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.ShortBuffer;
import java.util.ArrayList;
import java.util.List;

/**
 * The built-in song editor that needs nothing but Android itself: it decodes any audio file
 * (MP3, M4A, AAC, Opus, FLAC, WAV, ...) with the phone's own decoders, edits the sound with
 * AudioCore, and saves an M4A (AAC) file with the phone's own encoder. Used when FFmpeg can't
 * run on a phone.
 *
 * Jobs (JSON):
 *   {"op":"waveform","src":path,"points":900}                         -> {"duration":s,"peaks":[...]}
 *   {"op":"trim","src":path,"keep":[[a,b],...],"fadeIn":s,"fadeOut":s,"out":path} -> {"duration":s}
 *   {"op":"merge","srcs":[paths],"crossfade":s,"gap":s,"out":path}    -> {"duration":s}
 */
final class AudioEditor {

    interface Callback {
        void done(boolean ok, String payload);
    }

    private AudioEditor() {
    }

    static void run(final String json, final Callback cb) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                String out = null;
                List<Decoder> open = new ArrayList<>();
                try {
                    JSONObject job = new JSONObject(json);
                    String op = job.getString("op");
                    JSONObject res = new JSONObject();
                    if ("waveform".equals(op)) {
                        Decoder d = new Decoder(job.getString("src"));
                        open.add(d);
                        long[] frames = new long[1];
                        float[] peaks = AudioCore.waveform(new AudioCore.Convert(d), job.optInt("points", 800), frames);
                        JSONArray arr = new JSONArray();
                        for (float p : peaks) arr.put(Math.round(p * 1000) / 1000.0);
                        res.put("duration", frames[0] / (double) AudioCore.RATE);
                        res.put("peaks", arr);
                    } else if ("trim".equals(op)) {
                        out = job.getString("out");
                        JSONArray k = job.getJSONArray("keep");
                        double[][] keep = new double[k.length()][2];
                        for (int i = 0; i < keep.length; i++) {
                            keep[i][0] = k.getJSONArray(i).getDouble(0);
                            keep[i][1] = k.getJSONArray(i).getDouble(1);
                        }
                        Decoder d = new Decoder(job.getString("src"));
                        open.add(d);
                        AacSink sink = new AacSink(out);
                        long frames;
                        try {
                            frames = AudioCore.trim(new AudioCore.Convert(d), sink, keep,
                                    job.optDouble("fadeIn", 0), job.optDouble("fadeOut", 0));
                            sink.finish();
                        } finally {
                            sink.release();
                        }
                        res.put("duration", frames / (double) AudioCore.RATE);
                    } else if ("merge".equals(op)) {
                        out = job.getString("out");
                        JSONArray s = job.getJSONArray("srcs");
                        List<AudioCore.PcmIn> ins = new ArrayList<>();
                        for (int i = 0; i < s.length(); i++) {
                            Decoder d = new Decoder(s.getString(i));
                            open.add(d);
                            ins.add(new AudioCore.Convert(d));
                        }
                        AacSink sink = new AacSink(out);
                        long frames;
                        try {
                            frames = AudioCore.merge(ins, sink, job.optDouble("crossfade", 0), job.optDouble("gap", 0));
                            sink.finish();
                        } finally {
                            sink.release();
                        }
                        res.put("duration", frames / (double) AudioCore.RATE);
                    } else {
                        throw new IllegalArgumentException("unknown job " + op);
                    }
                    cb.done(true, res.toString());
                } catch (Throwable e) {
                    if (out != null) {
                        //noinspection ResultOfMethodCallIgnored
                        new File(out).delete();
                    }
                    String msg = e.getMessage();
                    cb.done(false, "Editing failed: " + (msg == null ? e.toString() : msg));
                } finally {
                    for (Decoder d : open) d.close();
                }
            }
        }, "ak-audio-editor").start();
    }

    // ------------------------------------------------------------------ decoding
    static final class Decoder implements AudioCore.RawIn {
        private final MediaExtractor extractor = new MediaExtractor();
        private final MediaCodec codec;
        private final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        private int rate, channels;
        private boolean floatPcm, inputDone, outputDone;
        private ByteBuffer pending;
        private int pendingIndex = -1;

        Decoder(String path) throws IOException {
            extractor.setDataSource(path);
            int track = -1;
            MediaFormat format = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat f = extractor.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    track = i;
                    format = f;
                    break;
                }
            }
            if (track < 0) {
                extractor.release();
                throw new IOException("no audio found in " + new File(path).getName());
            }
            extractor.selectTrack(track);
            rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));
            codec.configure(format, null, null, 0);
            codec.start();
        }

        @Override
        public int rate() {
            return rate;
        }

        @Override
        public int channels() {
            return channels;
        }

        @Override
        public int read(short[] out) {
            int guard = 0;
            while (true) {
                if (pending != null) {
                    int n;
                    int ch = Math.max(1, channels);
                    if (floatPcm) {
                        FloatBuffer fb = pending.slice().order(ByteOrder.nativeOrder()).asFloatBuffer();
                        n = Math.min(out.length, fb.remaining());
                        n -= n % ch;
                        for (int i = 0; i < n; i++) out[i] = AudioCore.clip(fb.get() * 32767.0);
                        pending.position(pending.position() + n * 4);
                    } else {
                        ShortBuffer sb = pending.slice().order(ByteOrder.nativeOrder()).asShortBuffer();
                        n = Math.min(out.length, sb.remaining());
                        n -= n % ch;
                        sb.get(out, 0, n);
                        pending.position(pending.position() + n * 2);
                    }
                    if (pending.remaining() < ch * (floatPcm ? 4 : 2)) {
                        codec.releaseOutputBuffer(pendingIndex, false);
                        pending = null;
                    }
                    if (n > 0) return n;
                    continue;
                }
                if (outputDone) return -1;
                if (!inputDone) {
                    int in = codec.dequeueInputBuffer(10000);
                    if (in >= 0) {
                        ByteBuffer b = codec.getInputBuffer(in);
                        int size = b == null ? -1 : extractor.readSampleData(b, 0);
                        if (size < 0) {
                            codec.queueInputBuffer(in, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            codec.queueInputBuffer(in, 0, size, extractor.getSampleTime(), 0);
                            extractor.advance();
                        }
                    }
                }
                int o = codec.dequeueOutputBuffer(info, 10000);
                if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat f = codec.getOutputFormat();
                    if (f.containsKey(MediaFormat.KEY_SAMPLE_RATE)) rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    if (f.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    floatPcm = f.containsKey(MediaFormat.KEY_PCM_ENCODING)
                            && f.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT;
                } else if (o >= 0) {
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true;
                    ByteBuffer b = codec.getOutputBuffer(o);
                    if (b != null && info.size > 0) {
                        b.position(info.offset);
                        b.limit(info.offset + info.size);
                        pending = b;
                        pendingIndex = o;
                    } else {
                        codec.releaseOutputBuffer(o, false);
                    }
                } else if (inputDone && ++guard > 500) {
                    return -1;   // decoder stopped answering at the very end: treat as finished
                }
            }
        }

        void close() {
            try {
                codec.stop();
            } catch (Exception ignored) {
            }
            try {
                codec.release();
            } catch (Exception ignored) {
            }
            try {
                extractor.release();
            } catch (Exception ignored) {
            }
        }
    }

    // ------------------------------------------------------------------ encoding to M4A (AAC)
    static final class AacSink implements AudioCore.PcmOut {
        private final MediaCodec codec;
        private final MediaMuxer muxer;
        private final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        private int track = -1;
        private boolean started;
        private long framesQueued;

        AacSink(String path) throws IOException {
            MediaFormat f = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, AudioCore.RATE, 2);
            f.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
            f.setInteger(MediaFormat.KEY_BIT_RATE, 192000);
            f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 65536);
            codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
            codec.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            codec.start();
            muxer = new MediaMuxer(path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
        }

        @Override
        public void write(short[] buf, int count) {
            int offset = 0;
            while (offset < count) {
                int in = codec.dequeueInputBuffer(10000);
                if (in >= 0) {
                    ByteBuffer b = codec.getInputBuffer(in);
                    b.clear();
                    int n = Math.min(count - offset, b.remaining() / 2);
                    n -= n % 2;
                    b.order(ByteOrder.nativeOrder()).asShortBuffer().put(buf, offset, n);
                    codec.queueInputBuffer(in, 0, n * 2, framesQueued * 1000000L / AudioCore.RATE, 0);
                    framesQueued += n / 2;
                    offset += n;
                }
                drain(false);
            }
        }

        void finish() {
            boolean queued = false;
            for (int tries = 0; !queued && tries < 1000; tries++) {
                int in = codec.dequeueInputBuffer(10000);
                if (in >= 0) {
                    codec.queueInputBuffer(in, 0, 0, framesQueued * 1000000L / AudioCore.RATE, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                    queued = true;
                } else {
                    drain(false);
                }
            }
            drain(true);
            if (started) muxer.stop();
        }

        private void drain(boolean untilEnd) {
            int idle = 0;
            while (true) {
                int o = codec.dequeueOutputBuffer(info, untilEnd ? 10000 : 0);
                if (o == MediaCodec.INFO_TRY_AGAIN_LATER) {
                    if (!untilEnd || ++idle > 300) return;
                } else if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    track = muxer.addTrack(codec.getOutputFormat());
                    muxer.start();
                    started = true;
                } else if (o >= 0) {
                    ByteBuffer b = codec.getOutputBuffer(o);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) info.size = 0;
                    if (b != null && info.size > 0 && started) {
                        b.position(info.offset);
                        b.limit(info.offset + info.size);
                        muxer.writeSampleData(track, b, info);
                    }
                    codec.releaseOutputBuffer(o, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) return;
                }
            }
        }

        void release() {
            try {
                codec.stop();
            } catch (Exception ignored) {
            }
            try {
                codec.release();
            } catch (Exception ignored) {
            }
            try {
                muxer.release();
            } catch (Exception ignored) {
            }
        }
    }
}
