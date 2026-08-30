const { encodeControlFrame, encodePcmFrame } = require('./sttFrameProtocol');

class SttInputWriter {
  constructor(stream, options = {}) {
    if (!stream || typeof stream.write !== 'function') {
      throw new TypeError('SttInputWriter requires a writable stream.');
    }
    this.stream = stream;
    this.onRecovered = typeof options.onRecovered === 'function' ? options.onRecovered : null;
    this.backpressured = false;
    this.droppedPcmBlocks = 0;
    this.destroyed = false;
    this._handleDrain = this._handleDrain.bind(this);
  }

  isWritable() {
    return !this.destroyed && this.stream && this.stream.writable !== false;
  }

  writePcm(pcm) {
    if (!this.isWritable()) return { written: false, reason: 'not-writable' };
    if (this.backpressured) {
      this.droppedPcmBlocks += 1;
      return { written: false, dropped: true, reason: 'backpressure' };
    }

    const accepted = this.stream.write(encodePcmFrame(pcm));
    if (!accepted) {
      this.backpressured = true;
      this.stream.once('drain', this._handleDrain);
    }
    return { written: true, backpressured: !accepted };
  }

  writeControl(control) {
    if (!this.isWritable()) return { written: false, reason: 'not-writable' };
    const accepted = this.stream.write(encodeControlFrame(control));
    return { written: true, backpressured: !accepted };
  }

  _handleDrain() {
    if (this.destroyed) return;
    this.backpressured = false;
    const dropped = this.droppedPcmBlocks;
    this.droppedPcmBlocks = 0;
    if (dropped > 0 && this.onRecovered) this.onRecovered(dropped);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.stream && typeof this.stream.removeListener === 'function') {
      this.stream.removeListener('drain', this._handleDrain);
    }
    this.stream = null;
    this.backpressured = false;
    this.droppedPcmBlocks = 0;
  }
}

module.exports = { SttInputWriter };
