(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
ALLEX.execSuite.libRegistry.register('allex_funddistributionbankextensionlib',require('./index')(ALLEX));

},{"./index":2}],2:[function(require,module,exports){
function createExtension (execlib) {
  'use strict';

  var lib = execlib.lib,
    q = lib.q,
    qlib = lib.qlib;

  function FundDistributionExtension (prophash) {
    this.accumulationfundname = prophash.accumulationfundname || 'accumulation';
    this.distribution = null;
    this.percentagepower = null;
    this.minpercentage = null;
    if (prophash.funddistribution) {
      this.setDistribution(prophash.funddistribution, prophash.initdistributionrefererencearray);
    }
  }
  FundDistributionExtension.prototype.destroy = function () {
    this.minpercentage = null;
    this.percentagepower = null;
    this.distribution = null;
    this.accumulationfundname = null;
  };
  FundDistributionExtension.prototype.setDistribution = function (distributionhash, referencearry) {
    var dist = [], minperc = Infinity;
    if (!distributionhash) {
      this.destroy();
      throw new lib.Error('NO_FUNDS', 'Fund distribution descriptor is not defined');
    }
    if (!(distributionhash.funds && Object.keys(distributionhash.funds).length>0)) {
      this.destroy();
      throw new lib.Error('NO_DISTRIBUTION', 'Distribution of the property hash has to be an object');
    }
    if (!lib.isArray(referencearry)) {
      throw new lib.Error('NO_REFERENCE_ARRAY', 'Reference array is needed to set the distribution');
    }
    this.percentagepower = Math.pow(10, distributionhash.percentagedecimals || 0);
    lib.traverseShallow(distributionhash.funds, function (perc, name) {
      dist.push({name: name, perc: perc});
      if (perc<minperc) {
        minperc = perc;
      }
    });
    this.distribution = dist;
    this.minpercentage = minperc;
    dist = null;
    minperc = null;
    return this.distribute(0, referencearry);
  };
  FundDistributionExtension.prototype.distribute = function (amount, referencearry) {
    if (!this.distribution) {
      return q.reject(new lib.Error('NO_DISTRIBUTION', 'Distribution has not been set yet'));
    }
    return this.calculateDistribution(amount).then(
      this.chargeDistribution.bind(this, referencearry)
    );
  };
  FundDistributionExtension.prototype.chargeDistribution = function (referencearry, dist) {
    return this.locks.run('distribute', this.distributionJob(referencearry, dist)).then(
      this.consolidateDistributionCharge.bind(this)
    );
  };
  FundDistributionExtension.prototype.distributionJob = function (referencearry, dist) {
    var t = this,
      ret = new qlib.PromiseExecutionMapperJob(dist.map(function (charge){
        return t.charge.bind(t, charge.name, charge.charge, referencearry);
    }));
    t = null;
    referencearry = null;
    return ret;
  };
  FundDistributionExtension.prototype.consolidateDistributionCharge = function (chargearry) {
    var ret = {};
    //console.log('consolidateDistributionCharge', chargearry);
    if (!(lib.isArray(chargearry) && chargearry.length>0)) {
      return q(ret);
    }
    if (chargearry.length>1) {
      this.distribution.forEach(function(distdesc, distindex) {
        ret[distdesc.name] = chargearry[distindex][1];
      });
    }
    ret[this.accumulationfundname] = chargearry[chargearry.length-1][1];
    chargearry = null;
    return q(ret);
  };
  FundDistributionExtension.prototype.calculateDistribution = function (amount) {
    return this.readAccountWDefault(this.accumulationfundname, 0).then(
      this.onAccumulationFundRead.bind(this, amount)
    );
  };
  FundDistributionExtension.prototype.onAccumulationFundRead = function (amount, accamount) {
    var distamount, ch, da;
    distamount = amount+accamount;
    if (this.distributedAmount(distamount, this.minpercentage)<1) {
      //console.log(distamount, 'too small for distribution');
      return q([{name: this.accumulationfundname, charge: -amount}]);
    }
    return q(this.distributeAmount(distamount, accamount));
  };
  FundDistributionExtension.prototype.distributeAmount = function (amount, accamount) {
    var accdelta, dist = this.distribution.reduce(this.distributedFundWithSummation.bind(this, amount), {sum: 0, distribution: []});
    accdelta = -dist.sum-amount+(accamount||0);
    //console.log('accdelta', accdelta, 'from', dist, 'because', amount);
    dist.distribution.push({name: this.accumulationfundname, charge: accdelta});
    console.log(amount, '=>', dist.distribution);
    return dist.distribution;
  };

  FundDistributionExtension.prototype.distributedFundWithSummation = function (amount, res, funddesc) {
    var df = this.distributedFund(amount, funddesc);
    res.sum += df.charge;
    res.distribution.push(df);
    return res;
  };
  FundDistributionExtension.prototype.distributedFund = function (amount, funddesc) {
    return {name: funddesc.name, charge: -this.distributedAmount(amount, funddesc.perc)};
  };
  FundDistributionExtension.prototype.distributedAmount = function (amount, percentage) {
    var ret;
    if (percentage <= 0) {
      return 0;
    }
    ret = percentage*Math.floor(amount/this.percentagepower/100);
    //console.log('this.percentagepower', this.percentagepower, 'distributes', amount, 'with', percentage, '=>', ret);
    return ret;
  };

  FundDistributionExtension.addMethods = function (klass) {
    lib.inheritMethods(klass, FundDistributionExtension,
      'setDistribution',
      'distribute',
      'chargeDistribution',
      'distributionJob',
      'consolidateDistributionCharge',
      'calculateDistribution',
      'onAccumulationFundRead',
      'distributeAmount',
      'distributedAmount',
      'distributedFund',
      'distributedFundWithSummation'
    );
  };
  return FundDistributionExtension;
}

module.exports = createExtension;

},{}]},{},[1]);
